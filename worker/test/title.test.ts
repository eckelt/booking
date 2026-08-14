import { describe, it, expect, vi } from "vitest";
import { slugify, fallbackName, fallbackNames, generateMeetingNames } from "../src/title.js";
import type { Env } from "../src/types.js";

const envWithKey = { ANTHROPIC_API_KEY: "sk-test" } as unknown as Env;
const envNoKey = {} as unknown as Env;

function anthropicResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }),
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

describe("fallbackName / fallbackNames", () => {
  it("uses a serious German opener as the primary", () => {
    expect(fallbackName("Felix Grothkopp", "de")).toEqual({
      title: "Termin mit Felix Grothkopp",
      slug: "felix-grothkopp",
    });
  });

  it("uses the English opener", () => {
    expect(fallbackName("Ian Thornton", "en").title).toBe("Meeting with Ian Thornton");
  });

  it("offers positive-adjective variants with distinct slugs", () => {
    const names = fallbackNames("Felix", "de");
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(names[0]).toEqual({ title: "Termin mit Felix", slug: "felix" });
    expect(names[1]).toEqual({ title: "Heiterer Termin mit Felix", slug: "heiterer-felix" });
    // every slug is unique
    const slugs = names.map((n) => n.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("generateMeetingNames", () => {
  it("returns the fallback and skips the API when there is no note", async () => {
    const fetcher = vi.fn();
    const result = await generateMeetingNames(
      envWithKey,
      { name: "Felix", notes: "   ", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result[0]).toEqual({ title: "Termin mit Felix", slug: "felix" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns the fallback when no API key is configured", async () => {
    const fetcher = vi.fn();
    const result = await generateMeetingNames(
      envNoKey,
      { name: "Felix", notes: "Klönschnack Kezchup", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result[0]!.title).toBe("Termin mit Felix");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the model's primary plus slugified alternatives", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      anthropicResponse({
        title: "Felix und Nils schnacken",
        slug: "felix-und-nils-schnacken",
        alternatives: [
          { title: "Heiterer Klönschnack mit Felix", slug: "heiterer-kloenschnack-felix" },
          { title: "Aufmerksamer Call mit Felix", slug: "aufmerksamer-call-felix" },
        ],
      }),
    );
    const result = await generateMeetingNames(
      envWithKey,
      { name: "Felix", notes: "Klönschnack Kezchup", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result).toEqual([
      { title: "Felix und Nils schnacken", slug: "felix-und-nils-schnacken" },
      { title: "Heiterer Klönschnack mit Felix", slug: "heiterer-kloenschnack-felix" },
      { title: "Aufmerksamer Call mit Felix", slug: "aufmerksamer-call-felix" },
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("re-slugifies a model slug that still carries umlauts", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      anthropicResponse({ title: "Björn und Nils", slug: "björn-und-nils" }),
    );
    const result = await generateMeetingNames(
      envWithKey,
      { name: "Björn", notes: "kurzes Update", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result[0]!.slug).toBe("bjoern-und-nils");
  });

  it("falls back on an API error", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await generateMeetingNames(
      envWithKey,
      { name: "Felix", notes: "etwas", lang: "de" },
      fetcher as unknown as typeof fetch,
    );
    expect(result[0]).toEqual({ title: "Termin mit Felix", slug: "felix" });
  });

  it("falls back when the model returns unparseable text", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "sorry!" }] }), { status: 200 }),
    );
    const result = await generateMeetingNames(
      envWithKey,
      { name: "Ian", notes: "quick sync", lang: "en" },
      fetcher as unknown as typeof fetch,
    );
    expect(result[0]).toEqual({ title: "Meeting with Ian", slug: "ian" });
  });
});
