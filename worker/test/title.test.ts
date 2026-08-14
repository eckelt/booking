import { describe, it, expect, vi } from "vitest";
import { slugify, fallbackName, generateMeetingName } from "../src/title.js";
import type { Env } from "../src/types.js";

const envWithKey = { ANTHROPIC_API_KEY: "sk-test" } as unknown as Env;
const envNoKey = {} as unknown as Env;

function anthropicResponse(title: string, slug: string): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ title, slug }) }] }),
    { status: 200 },
  );
}

describe("slugify", () => {
  it("transliterates German umlauts to digraphs", () => {
    expect(slugify("Björn Klön")).toBe("bjoern-kloen");
    expect(slugify("Müller & Weiß")).toBe("mueller-weiss");
  });

  it("strips other accents", () => {
    expect(slugify("Café résumé")).toBe("cafe-resume");
  });

  it("collapses separators and trims", () => {
    expect(slugify("  Felix   und Nils!!  ")).toBe("felix-und-nils");
  });

  it("falls back to 'meeting' for empty input", () => {
    expect(slugify("   ")).toBe("meeting");
    expect(slugify("!!!")).toBe("meeting");
  });
});

describe("fallbackName", () => {
  it("uses a serious German opener", () => {
    expect(fallbackName("Felix Grothkopp", "de")).toEqual({
      title: "Termin mit Felix Grothkopp",
      slug: "felix-grothkopp",
    });
  });

  it("uses the English opener", () => {
    expect(fallbackName("Ian Thornton", "en").title).toBe("Meeting with Ian Thornton");
  });
});

describe("generateMeetingName", () => {
  it("returns the fallback and skips the API when there is no note", async () => {
    const fetcher = vi.fn();
    const result = await generateMeetingName(
      envWithKey,
      { name: "Felix", notes: "   ", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result).toEqual({ title: "Termin mit Felix", slug: "felix" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns the fallback when no API key is configured", async () => {
    const fetcher = vi.fn();
    const result = await generateMeetingName(
      envNoKey,
      { name: "Felix", notes: "Klönschnack Kezchup", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result.title).toBe("Termin mit Felix");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the model's title and slugifies its slug", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      anthropicResponse("Felix und Nils schnacken", "felix-und-nils-schnacken"),
    );
    const result = await generateMeetingName(
      envWithKey,
      { name: "Felix", notes: "Klönschnack Kezchup", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result).toEqual({
      title: "Felix und Nils schnacken",
      slug: "felix-und-nils-schnacken",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("re-slugifies a model slug that still carries umlauts", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      anthropicResponse("Björn und Nils", "björn-und-nils"),
    );
    const result = await generateMeetingName(
      envWithKey,
      { name: "Björn", notes: "kurzes Update", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result.slug).toBe("bjoern-und-nils");
  });

  it("falls back on an API error", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await generateMeetingName(
      envWithKey,
      { name: "Felix", notes: "etwas", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result).toEqual({ title: "Termin mit Felix", slug: "felix" });
  });

  it("falls back when the model returns unparseable text", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "sorry!" }] }), { status: 200 }),
    );
    const result = await generateMeetingName(
      envWithKey,
      { name: "Ian", notes: "quick sync", lang: "en" },
      fetcher as unknown as typeof fetch,
    );
    expect(result).toEqual({ title: "Meeting with Ian", slug: "ian" });
  });
});
