import type { Env } from "./types.js";

// Anthropic Claude Haiku — fast and reliable at short structured JSON and
// German. Requires the ANTHROPIC_API_KEY secret; without it (or on any error)
// bookings fall back to a plain title, so a booking never fails on this.
const MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 8000;

export interface MeetingName {
  title: string;
  slug: string;
}

const SYSTEM_PROMPT = [
  "You name calendar meetings for Nils Eckelt's booking page.",
  "A person has booked a call and left a short note. Craft a warm but professional meeting title, a matching URL slug, and a few alternative variants (used only if the primary slug is already taken).",
  'Reply with ONLY a compact JSON object and nothing else — no markdown, no code fences, no prose: {"title": "...", "slug": "...", "alternatives": [{"title": "...", "slug": "..."}, ...]}',
  "title: name what the meeting is ABOUT — the activity or topic from the note — in AS FEW WORDS AS POSSIBLE (aim for 2-4 words). Requested language (de/en); warm and professional; no emojis, no surrounding quotes. Include the booker's first name ONLY when the note is too generic to make a distinctive title on its own (and the name fits naturally); when the note already describes something specific, leave the name out. Do NOT glue a generic opener onto the raw note. Examples — note \"Wir wollen Rad fahren am Krupunder See\" -> \"Radtour am Krupunder See\" (de) / \"Cycling at Krupunder See\" (en); generic note \"kurzes Update\", booker \"Horst\" -> \"Update mit Horst\" (de). Avoid flat concatenations like \"Termin Huhn Stall ausmisten\".",
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
  fetcher: typeof fetch = fetch,
): Promise<MeetingName[]> {
  const fallback = fallbackNames(input.name, input.lang);
  if (!input.notes.trim() || !env.ANTHROPIC_API_KEY) return fallback;

  try {
    const raw = await callClaude(env, input, fetcher);
    const title = String(raw.title ?? "").trim();
    const slug = slugify(String(raw.slug ?? title));
    if (!title || !slug) {
      console.error(`[title] unusable model output: ${JSON.stringify(raw).slice(0, 300)}`);
      return fallback;
    }

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

async function callClaude(
  env: Env,
  input: { name: string; notes: string; lang: "de" | "en" },
  fetcher: typeof fetch,
): Promise<{ title?: unknown; slug?: unknown; alternatives?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Language: ${input.lang}\nBooker: ${input.name}\nNote: ${input.notes}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === "text")?.text ?? "";
    return parseJsonObject(text);
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(text: string): { title?: unknown; slug?: unknown; alternatives?: unknown } {
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
