import type { Env } from "./types.js";

// Cloudflare Workers AI text model — runs on the same account as the Worker, no
// external API key. Swap for a larger Llama if German quality needs a boost.
const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const TIMEOUT_MS = 5000;

export interface MeetingName {
  title: string;
  slug: string;
}

const SYSTEM_PROMPT = [
  "You name calendar meetings for Nils Eckelt's booking page.",
  "A person has booked a call and left a short note. Craft a warm but professional meeting title, a matching URL slug, and a few alternative variants (used only if the primary slug is already taken).",
  'Reply with ONLY a compact JSON object and nothing else — no markdown, no code fences, no prose: {"title": "...", "slug": "...", "alternatives": [{"title": "...", "slug": "..."}, ...]}',
  "title: match the requested language (de/en), short (max ~6 words), friendly yet serious — no emojis, no surrounding quotes. Mention the booker's first name and Nils. Good German openers: \"Termin mit\", \"Besprechung mit\", \"Meeting mit\".",
  "slug: lowercase ASCII words joined by hyphens, ~2-5 words, no umlauts or accents. Transliterate names (Björn -> bjoern, ö->oe, ä->ae, ü->ue, ß->ss). For casual note words you may pick a pretty umlaut-free synonym (e.g. klönen -> schnacken) to keep the slug nice.",
  "alternatives: 3 variants that stay pretty by prepending a positive adjective, each with its own distinct slug. Keep correct German adjective agreement with the noun in the title (der Termin / der Call -> -er ending: \"Heiterer Termin\"; die Besprechung -> -e ending: \"Heitere Besprechung\"). English: a plain positive adjective (\"Warm Meeting with …\"). Examples: \"Aufmerksamer Termin mit …\", \"Heiterer Call mit …\", \"Lebendige Besprechung mit …\".",
].join("\n");

// Turn the booker's name + note into meeting-name candidates via Claude, best
// first. The caller uses the first whose slug isn't already taken; the extras
// are pretty adjective variants ("Heiterer Termin mit …") for that rare clash.
// Always resolves — on a missing note, missing key, timeout, or any API error
// it returns the plain fallback candidates, so a booking never fails on this.
export async function generateMeetingNames(
  env: Env,
  input: { name: string; notes: string; lang: "de" | "en" },
): Promise<MeetingName[]> {
  const fallback = fallbackNames(input.name, input.lang);
  if (!input.notes.trim() || !env.AI) return fallback;

  try {
    const raw = await withTimeout(callWorkersAi(env.AI, input), TIMEOUT_MS);
    const title = String(raw.title ?? "").trim();
    const slug = slugify(String(raw.slug ?? title));
    if (!title || !slug) return fallback;

    const names: MeetingName[] = [{ title, slug }];
    const alts = Array.isArray(raw.alternatives) ? raw.alternatives : [];
    for (const a of alts) {
      const altTitle = String((a as { title?: unknown })?.title ?? "").trim();
      const altSlug = slugify(String((a as { slug?: unknown })?.slug ?? altTitle));
      if (altTitle && altSlug) names.push({ title: altTitle, slug: altSlug });
    }
    return names;
  } catch (err) {
    console.error(`[title] generation failed: ${(err as Error)?.message ?? err}`);
    return fallback;
  }
}

// Plain, key-free candidates: a serious primary plus positive-adjective variants
// (grammatically fixed to the masculine "Termin" / "Meeting") for disambiguation.
export function fallbackNames(name: string, lang: "de" | "en"): MeetingName[] {
  const noun = lang === "en" ? "Meeting with" : "Termin mit";
  const adjectives = lang === "en"
    ? ["", "Warm", "Friendly", "Focused"]
    : ["", "Heiterer", "Aufmerksamer", "Lebhafter"];
  return adjectives.map((adj) => ({
    title: adj ? `${adj} ${noun} ${name}` : `${noun} ${name}`,
    slug: slugify(adj ? `${adj} ${name}` : name),
  }));
}

// The single best plain fallback name (primary candidate).
export function fallbackName(name: string, lang: "de" | "en"): MeetingName {
  return fallbackNames(name, lang)[0]!;
}

async function callWorkersAi(
  ai: NonNullable<Env["AI"]>,
  input: { name: string; notes: string; lang: "de" | "en" },
): Promise<{ title?: unknown; slug?: unknown; alternatives?: unknown }> {
  const result = await ai.run(MODEL, {
    max_tokens: 400,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Language: ${input.lang}\nBooker: ${input.name}\nNote: ${input.notes}`,
      },
    ],
  });
  return parseJsonObject(result.response ?? "");
}

// Resolve to the promise, or reject once the timeout elapses — so a slow model
// never holds up a booking (the caller falls back on rejection).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function parseJsonObject(text: string): { title?: unknown; slug?: unknown } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

// Reduce a string to a URL-safe [a-z0-9-] slug. German umlauts become digraphs
// (ö->oe) before other diacritics are stripped (é->e), so "Björn" -> "bjoern".
export function slugify(input: string): string {
  const ascii = input
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "ae").replace(/Ö/g, "oe").replace(/Ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return (
    ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "meeting"
  );
}
