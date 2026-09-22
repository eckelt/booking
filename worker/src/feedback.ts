import type { Env } from "./types.js";
import { sendSmtp, withRetry, type SmtpMessage } from "./email.js";
import { renderFeedbackForm, renderFeedbackNotice } from "./feedback-page.js";
import catalog from "./feedback-events.json";

// feedback.ecke.lt — a one-screen feedback form for workshops and talks.
// Each event is an entry in feedback-events.json, reachable at
// feedback.ecke.lt/<slug>; the bare host is a general form with no event.
// Submissions are mailed to FEEDBACK_EMAIL (no database).

export const FEEDBACK_HOST = "feedback.ecke.lt";

export type Lang = "de" | "en";
export type Rating = "up" | "side" | "down";

export interface FeedbackEvent {
  title: string;
  date: string; // YYYY-MM-DD, Europe/Berlin
  lang: Lang;
  // Days after `date` the form stays open (inclusive). Defaults to 10.
  openDays?: number;
}

export type EventCatalog = Record<string, FeedbackEvent>;

export interface FeedbackSubmission {
  slug: string | null;
  rating: Rating;
  text: string;
  name: string;
  lang: Lang;
}

const DEFAULT_OPEN_DAYS = 10;
export const MAX_TEXT = 5000;
export const MAX_NAME = 100;
const RATINGS: Rating[] = ["up", "side", "down"];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Mail goes to the owner, so it's always German regardless of form language.
export const RATING_MAIL_LABEL: Record<Rating, string> = {
  up: "👍 Nicht schlecht",
  side: "👉 Nicht gut, kann dir aber nicht sagen warum",
  down: "👎 Schlecht, weil …",
};

export class FeedbackError extends Error {
  constructor(public code: string, public status = 422) {
    super(code);
  }
}

const EVENTS = catalog as EventCatalog;

export function findEvent(slug: string, events: EventCatalog = EVENTS): FeedbackEvent | null {
  const key = slug.toLowerCase();
  if (!SLUG_RE.test(key) || !Object.hasOwn(events, key)) return null;
  return events[key] ?? null;
}

// The form closes at the end of (date + openDays) in Berlin time; before the
// event it is already open, so the link can be tested and shared ahead.
export function isOpen(event: FeedbackEvent, now = new Date()): boolean {
  return berlinDate(now) <= addDays(event.date, event.openDays ?? DEFAULT_OPEN_DAYS);
}

export function berlinDate(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function validateFeedback(body: unknown): FeedbackSubmission {
  if (!body || typeof body !== "object") throw new FeedbackError("invalid");
  const b = body as Record<string, unknown>;

  const rating = b.rating as Rating;
  if (!RATINGS.includes(rating)) throw new FeedbackError("invalid");

  const text = typeof b.text === "string" ? b.text.trim() : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (text.length > MAX_TEXT || name.length > MAX_NAME) throw new FeedbackError("too_long");
  if (rating === "down" && !text) throw new FeedbackError("reason_required");

  const slug = typeof b.slug === "string" && b.slug ? b.slug.toLowerCase() : null;
  const lang: Lang = b.lang === "en" ? "en" : "de";
  return { slug, rating, text, name, lang };
}

export function buildFeedbackMail(
  env: Env,
  fb: FeedbackSubmission,
  event: FeedbackEvent | null,
  now = new Date(),
): SmtpMessage {
  const about = event ? event.title : "Allgemeines Feedback";
  const received = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);

  const text = `${about}${event ? ` (${fb.slug}, ${event.date})` : ""}

Daumen:  ${RATING_MAIL_LABEL[fb.rating]}
Name:    ${fb.name || "anonym"}
Sprache: ${fb.lang}
Zeit:    ${received}

${fb.text || "(kein Text)"}
`;

  return {
    from: `${FEEDBACK_HOST} <${env.OWNER_EMAIL}>`,
    to: env.FEEDBACK_EMAIL || env.OWNER_EMAIL,
    subject: `[Feedback] ${about} – ${RATING_MAIL_LABEL[fb.rating]}`,
    text,
  };
}

export async function handleFeedback(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/api/feedback") {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    return submitFeedback(request, env);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method not allowed" }, 405);
  }

  const acceptLang = pickLang(request.headers.get("Accept-Language"));
  if (path === "/") {
    return html(renderFeedbackForm({ lang: acceptLang, slug: null, event: null }));
  }

  const slug = path.slice(1).toLowerCase();
  const event = findEvent(slug);
  if (!event) {
    return html(renderFeedbackNotice(acceptLang, "notFound"), 404);
  }
  if (!isOpen(event)) {
    return html(renderFeedbackNotice(event.lang, "closed", event), 410);
  }
  return html(renderFeedbackForm({ lang: event.lang, slug, event }));
}

async function submitFeedback(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  // Honeypot: a hidden field only bots fill in. Pretend success, send nothing.
  if (body && typeof body === "object" && (body as Record<string, unknown>).website) {
    return json({ ok: true });
  }

  let fb: FeedbackSubmission;
  let event: FeedbackEvent | null = null;
  try {
    fb = validateFeedback(body);
    if (fb.slug) {
      event = findEvent(fb.slug);
      if (!event) throw new FeedbackError("unknown_event", 404);
      if (!isOpen(event)) throw new FeedbackError("closed", 410);
    }
  } catch (err) {
    if (err instanceof FeedbackError) return json({ error: err.code }, err.status);
    throw err;
  }

  try {
    await withRetry(() => sendSmtp(env, buildFeedbackMail(env, fb, event)));
  } catch (err) {
    console.error(`[feedback] send failed slug=${fb.slug ?? "-"} error=${(err as Error).message}`);
    return json({ error: "send_failed" }, 502);
  }
  return json({ ok: true });
}

export function pickLang(acceptLanguage: string | null): Lang {
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "de";
}

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
