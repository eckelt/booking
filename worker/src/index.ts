import type { Env, Interval } from "./types.js";
import { SlotUnavailableError, RescheduleTargetGoneError } from "./types.js";
import { fetchBusy, deleteEvent, getEvent } from "./caldav.js";
import { workingDayWindow, computeSlots, excludeMovingEvent } from "./availability.js";
import { validateBookingRequest, createBooking } from "./booking.js";
import { generateJitsiUrl } from "./jitsi.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://book.ecke.lt",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PAGE_STYLE = `
  @font-face { font-family: "Bricolage Grotesque"; font-style: normal; font-weight: 400 800; font-display: swap; src: url("https://nils.ecke.lt/fonts/bricolage-grotesque.woff2") format("woff2"); }
  @font-face { font-family: "DM Sans"; font-style: normal; font-weight: 400 500; font-display: swap; src: url("https://nils.ecke.lt/fonts/dm-sans.woff2") format("woff2"); }
  :root { --bg: #fff; --text: #2c292d; --muted: #736e73; --accent: #006e8a; --rule: #e8e2dc; }
  @media (prefers-color-scheme: dark) { :root { --bg: #19181a; --text: #fcfcfa; --muted: #848085; --accent: #78dce8; --rule: #403e41; } }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 17px; }
  body { background: var(--bg); color: var(--text); font-family: "DM Sans", system-ui, sans-serif; line-height: 1.75; padding: 0 1.5rem 5rem; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .wrap { max-width: 480px; width: 100%; }
  h1 { font-family: "Bricolage Grotesque", system-ui, sans-serif; font-weight: 800; font-size: clamp(2rem, 6vw, 3rem); line-height: 1.1; letter-spacing: -0.02em; margin-bottom: 1.25rem; }
  p { color: var(--muted); margin-bottom: 0.75rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .back { display: inline-block; margin-top: 2rem; font-size: 0.85rem; color: var(--muted); }
  .rule { border: none; border-top: 1px solid var(--rule); margin: 2rem 0; }
`;

function page(title: string, heading: string, body: string, status = 200): Response {
  return html(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} – Nils Eckelt</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="wrap">
  <h1>${heading}</h1>
  ${body}
  <a class="back" href="https://book.ecke.lt">← Neuen Termin buchen</a>
</div>
</body>
</html>`, status);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === "/api/slots" && request.method === "GET") {
        return await handleSlots(url, env);
      }
      if (url.pathname === "/api/reschedule-info" && request.method === "GET") {
        return await handleRescheduleInfo(url, env);
      }
      if (url.pathname === "/api/book" && request.method === "POST") {
        return await handleBook(request, env, ctx);
      }
      if (url.pathname === "/api/cancel" && request.method === "GET") {
        return await handleCancel(url, request, env);
      }
      if (url.pathname === "/api/join" && request.method === "GET") {
        return await handleJoin(url.searchParams.get("uid"), url, env);
      }
      if (url.hostname === "join.ecke.lt" && request.method === "GET") {
        return await handleJoin(url.pathname.slice(1), url, env);
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "internal error" }, 500);
    }
  },
};

async function checkRateLimit(
  env: Env,
  ip: string,
  action: string,
  limit: number,
  windowSecs: number,
): Promise<boolean> {
  if (!env.RATE_LIMIT) return true;
  const window = Math.floor(Date.now() / (windowSecs * 1000));
  const key = `rl:${action}:${ip}:${window}`;
  const val = await env.RATE_LIMIT.get(key);
  const count = val ? parseInt(val, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: windowSecs * 2 });
  return true;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function handleJoin(rawUid: string | null, url: URL, env: Env): Promise<Response> {
  const uid = rawUid?.trim();
  if (!uid || !/^[\w-]+$/.test(uid)) {
    return page(
      "Ungültiger Link",
      "Ungültiger Meeting-Link",
      "<p>Dieser Link ist nicht gültig. Bitte prüfe deine Buchungsbestätigung.</p>",
      400
    );
  }
  const hostSecret = url.searchParams.get("host")?.trim();
  const expectedSecret = env.HOST_JOIN_SECRET?.trim();
  const isHost = !!hostSecret && !!expectedSecret && timingSafeEqual(hostSecret, expectedSecret);

  const now = new Date();
  const expires = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const jaasUrl = await generateJitsiUrl(
    uid, now, expires,
    env.JAAS_APP_ID, env.JAAS_KEY_ID, env.JAAS_PRIVATE_KEY,
    isHost ? { name: env.OWNER_NAME, email: env.OWNER_EMAIL } : null
  );
  return Response.redirect(jaasUrl, 302);
}

async function handleSlots(url: URL, env: Env): Promise<Response> {
  const durationMin = parseInt(url.searchParams.get("duration") ?? "30");
  if (![30, 60].includes(durationMin)) {
    return json({ error: "duration must be 30 or 60" }, 400);
  }

  const now = new Date();
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 14);

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : now;
  const to = toParam ? new Date(toParam) : maxDate;

  if (to > maxDate) {
    return json({ error: "to exceeds 14-day limit" }, 400);
  }

  const ownerHours = {
    tz: env.OWNER_TZ || "Europe/Berlin",
    minHour: parseHour(env.OWNER_MIN_HOUR, 9),
    maxHour: parseHour(env.OWNER_MAX_HOUR, 17),
  };

  // One CalDAV query per calendar for the whole [from, to] window, instead of
  // two per day — a fresh page prefetches ~15 days, so per-day fan-out meant
  // ~30 Fastmail requests per load (and 429s). computeSlots clamps this shared
  // busy set to each day's window.
  const rangeStart = new Date(from);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(to);
  rangeEnd.setHours(23, 59, 59, 999);

  let allBusy: Interval[];
  try {
    const [nilsBusy, ohanaBusy] = await Promise.all([
      fetchBusy(env, env.CALDAV_CALENDAR_NILS, rangeStart, rangeEnd),
      fetchBusy(env, env.CALDAV_CALENDAR_OHANA, rangeStart, rangeEnd),
    ]);
    allBusy = [...nilsBusy, ...ohanaBusy];
  } catch (err) {
    console.error(err);
    return json({ error: "calendar unavailable" }, 500);
  }

  // Rescheduling: exclude the event being moved from its own busy check, the
  // same way /api/book does — otherwise this listing and the booking it
  // feeds disagree on where slot boundaries fall (the old event's buffer can
  // shift where a free gap starts), and a slot offered here can come back
  // "no longer available" when actually submitted. Looks the event up too
  // (not just uid-matching busy intervals) so the exclusion still works even
  // if a CalDAV response doesn't carry the uid on an expanded VEVENT.
  const rescheduleUid = url.searchParams.get("reschedule")?.trim();
  if (rescheduleUid && /^[\w-]+$/.test(rescheduleUid)) {
    const oldEvent = await getEvent(env, rescheduleUid).catch(() => null);
    allBusy = excludeMovingEvent(allBusy, rescheduleUid, oldEvent);
  }

  const slots = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= to) {
    const window = workingDayWindow(cursor, ownerHours);
    if (window) {
      const windowStart = cursor.getTime() === from.getTime() && from > window.start
        ? from
        : window.start;
      const daySlots = computeSlots(allBusy, windowStart, window.end, durationMin * 60 * 1000);

      for (const slot of daySlots) {
        if (slot.start >= now) {
          slots.push({
            start: toLocalIso(slot.start),
            end: toLocalIso(slot.end),
          });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return json({ slots });
}

// Lets the frontend bootstrap a reschedule link (just "?reschedule=<uid>",
// no duration/name/email) with the one thing it needs before it can even
// show a calendar: how long the slot grid should be.
async function handleRescheduleInfo(url: URL, env: Env): Promise<Response> {
  const uid = url.searchParams.get("uid")?.trim();
  if (!uid || !/^[\w-]+$/.test(uid)) {
    return json({ error: "invalid uid" }, 400);
  }
  const event = await getEvent(env, uid).catch(() => null);
  if (!event) {
    return json({ error: "not found" }, 404);
  }
  const durationMin = Math.round((event.end.getTime() - event.start.getTime()) / 60000);
  return json({ duration: durationMin });
}

async function handleBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await checkRateLimit(env, ip, "book", 5, 3600))) {
    return json({ error: "Zu viele Anfragen. Bitte versuche es später erneut." }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  let req;
  try {
    req = validateBookingRequest(body);
  } catch (err) {
    return json({ error: (err as Error).message }, 422);
  }

  try {
    const result = await createBooking(env, req, ctx);
    return json(result, 201);
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return json({ error: "slot no longer available" }, 409);
    }
    if (err instanceof RescheduleTargetGoneError) {
      return json({ error: "this booking could no longer be found — please make a new booking" }, 410);
    }
    throw err;
  }
}

async function handleCancel(url: URL, request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await checkRateLimit(env, ip, "cancel", 10, 3600))) {
    return page(
      "Zu viele Anfragen",
      "Zu viele Anfragen",
      "<p>Bitte versuche es später erneut.</p>",
      429
    );
  }

  const uid = url.searchParams.get("uid")?.trim();
  if (!uid || !/^[\w-]+$/.test(uid)) {
    return page(
      "Ungültiger Link",
      "Ungültiger Storno-Link",
      "<p>Dieser Link ist nicht gültig.</p>",
      400
    );
  }
  await deleteEvent(env, uid);
  return page(
    "Termin storniert",
    "Termin storniert",
    "<p>Dein Termin wurde aus dem Kalender entfernt.</p>"
  );
}

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function parseHour(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : fallback;
}

function toLocalIso(d: Date): string {
  const offset = getOffsetMinutes(d, "Europe/Berlin");
  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  const hh = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const mm = String(absOffset % 60).padStart(2, "0");
  const local = new Date(d.getTime() + offset * 60000);
  return local.toISOString().replace("Z", `${sign}${hh}:${mm}`);
}

function getOffsetMinutes(d: Date, tz: string): number {
  const utc = d.getTime();
  const localStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(new Date(utc));
  const localMs = new Date(localStr.replace(" ", "T") + "Z").getTime();
  return Math.round((localMs - utc) / 60000);
}
