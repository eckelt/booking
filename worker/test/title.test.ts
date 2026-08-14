import { describe, it, expect, vi } from "vitest";
import { slugify, fallbackName, fallbackNames, generateMeetingNames } from "../src/title.js";
import type { Env } from "../src/types.js";

// Build an Env whose Workers AI binding runs the given mock.
function envWithAi(run: (...args: unknown[]) => unknown): Env {
  return { AI: { run } } as unknown as Env;
}

// A Workers AI text-generation response carrying JSON in `.response`.
function aiResponse(payload: unknown) {
  return { response: JSON.stringify(payload) };
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
  it("returns the fallback and skips the model when there is no note", async () => {
    const run = vi.fn();
    const result = await generateMeetingNames(envWithAi(run), {
      name: "Felix", notes: "   ", lang: "de",
    });
    expect(result[0]).toEqual({ title: "Termin mit Felix", slug: "felix" });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the fallback when no AI binding is available", async () => {
    const result = await generateMeetingNames({} as unknown as Env, {
      name: "Felix", notes: "Klönschnack Kezchup", lang: "de",
    });
    expect(result[0]!.title).toBe("Termin mit Felix");
  });

  it("uses the model's primary plus slugified alternatives", async () => {
    const run = vi.fn().mockResolvedValue(
      aiResponse({
        title: "Felix und Nils schnacken",
        slug: "felix-und-nils-schnacken",
        alternatives: [
          { title: "Heiterer Klönschnack mit Felix", slug: "heiterer-kloenschnack-felix" },
          { title: "Aufmerksamer Call mit Felix", slug: "aufmerksamer-call-felix" },
        ],
      }),
    );
    const result = await generateMeetingNames(envWithAi(run), {
      name: "Felix", notes: "Klönschnack Kezchup", lang: "de",
    });
    expect(result).toEqual([
      { title: "Felix und Nils schnacken", slug: "felix-und-nils-schnacken" },
      { title: "Heiterer Klönschnack mit Felix", slug: "heiterer-kloenschnack-felix" },
      { title: "Aufmerksamer Call mit Felix", slug: "aufmerksamer-call-felix" },
    ]);
    expect(run).toHaveBeenCalledOnce();
  });

  it("accepts an already-parsed object response (JSON mode)", async () => {
    const run = vi.fn().mockResolvedValue({
      response: { title: "Pokémon-Runde mit Nils", slug: "pokemon-runde-mit-nils" },
    });
    const result = await generateMeetingNames(envWithAi(run), {
      name: "Nils", notes: "Pokémon Spiele mit dem Sohn", lang: "de",
    });
    expect(result[0]).toEqual({
      title: "Pokémon-Runde mit Nils",
      slug: "pokemon-runde-mit-nils",
    });
  });

  it("re-slugifies a model slug that still carries umlauts", async () => {
    const run = vi.fn().mockResolvedValue(
      aiResponse({ title: "Björn und Nils", slug: "björn-und-nils" }),
    );
    const result = await generateMeetingNames(envWithAi(run), {
      name: "Björn", notes: "kurzes Update", lang: "de",
    });
    expect(result[0]!.slug).toBe("bjoern-und-nils");
  });

  it("falls back when the model call rejects", async () => {
    const run = vi.fn().mockRejectedValue(new Error("workers-ai down"));
    const result = await generateMeetingNames(envWithAi(run), {
      name: "Felix", notes: "etwas", lang: "de",
    });
    expect(result[0]).toEqual({ title: "Termin mit Felix", slug: "felix" });
  });

  it("falls back when the model returns unparseable text", async () => {
    const run = vi.fn().mockResolvedValue({ response: "sorry, no JSON here!" });
    const result = await generateMeetingNames(envWithAi(run), {
      name: "Ian", notes: "quick sync", lang: "en",
    });
    expect(result[0]).toEqual({ title: "Meeting with Ian", slug: "ian" });
  });
});
