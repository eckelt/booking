import type { Env } from "./types.js";

const MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 5000;

export interface MeetingName {
  title: string;
  slug: string;
}

const SYSTEM_PROMPT = [
  "You name calendar meetings for Nils Eckelt's booking page.",
  "A person has booked a call and left a short note. Craft a warm but professional meeting title and a matching URL slug.",
  'Reply with ONLY a compact JSON object: {"title": "...", "slug": "..."}',
  "title: match the requested language (de/en), short (max ~6 words), friendly yet serious — no emojis, no surrounding quotes. Mention the booker's first name and Nils. Good German openers: \"Termin mit\", \"Besprechung mit\", \"Meeting mit\".",
  "slug: lowercase ASCII words joined by hyphens, ~2-5 words, no umlauts or accents. Transliterate names (Björn -> bjoern, ö->oe, ä->ae, ü->ue, ß->ss). For casual note words you may pick a pretty umlaut-free synonym (e.g. klönen -> schnacken) to keep the slug nice.",
].join("\n");

// Turn the booker's name + note into a nice meeting title and URL slug via
// Claude. Always resolves — on a missing note, missing key, timeout, or any
// API error it returns the plain fallback, so a booking never fails on this.
export async function generateMeetingName(
  env: Env,
  input: { name: string; notes: string; lang: "de" | "en" },
  fetcher: typeof fetch = fetch,
): Promise<MeetingName> {
  const fallback = fallbackName(input.name, input.lang);
  if (!input.notes.trim() || !env.ANTHROPIC_API_KEY) return fallback;

  try {
    const raw = await callClaude(env, input, fetcher);
    const title = String(raw.title ?? "").trim();
    const slug = slugify(String(raw.slug ?? title));
    if (!title || !slug) return fallback;
    return { title, slug };
  } catch (err) {
    console.error(`[title] generation failed: ${(err as Error)?.message ?? err}`);
    return fallback;
  }
}

export function fallbackName(name: string, lang: "de" | "en"): MeetingName {
  const title = lang === "en" ? `Meeting with ${name}` : `Termin mit ${name}`;
  return { title, slug: slugify(name) };
}

async function callClaude(
  env: Env,
  input: { name: string; notes: string; lang: "de" | "en" },
  fetcher: typeof fetch,
): Promise<{ title?: unknown; slug?: unknown }> {
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
        max_tokens: 200,
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
    const data = (await res.json()) as { content?: { text?: string }[] };
    return parseJsonObject(data.content?.[0]?.text ?? "");
  } finally {
    clearTimeout(timer);
  }
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
