import type { Env, Interval } from "./types.js";
import { SlotUnavailableError } from "./types.js";
import { fetchBusy, deleteEvent } from "./caldav.js";
import { workingDayWindow, computeSlots } from "./availability.js";
import { validateBookingRequest, createBooking } from "./booking.js";
import { generateJitsiUrl } from "./jitsi.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://book.ecke.lt",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
      if (url.pathname === "/api/book" && request.method === "POST") {
        return await handleBook(request, env, ctx);
      }
      if (url.pathname === "/api/cancel" && request.method === "GET") {
        return await handleCancel(url, request, env);
      }
      if (url.pathname === "/api/join" && request.method === "GET") {
        return await handleJoin(url, env);
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

async function handleJoin(url: URL, env: Env): Promise<Response> {
  const uid = url.searchParams.get("uid")?.trim();
  if (!uid || !/^[\w-]+$/.test(uid)) {
    return html("<h2>Invalid meeting link.</h2>", 400);
  }
  const now = new Date();
  const expires = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const jaasUrl = await generateJitsiUrl(
    uid, now, expires,
    env.JAAS_APP_ID, env.JAAS_KEY_ID, env.JAAS_PRIVATE_KEY
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

  const slots = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  try {
    while (cursor <= to) {
      const window = workingDayWindow(cursor);
      if (window) {
        const windowStart = cursor.getTime() === from.getTime() && from > window.start
          ? from
          : window.start;

        const [nilsBusy, ohanaBusy] = await Promise.all([
          fetchBusy(env, env.CALDAV_CALENDAR_NILS, window.start, window.end),
          fetchBusy(env, env.CALDAV_CALENDAR_OHANA, window.start, window.end),
        ]);

        const allBusy: Interval[] = [...nilsBusy, ...ohanaBusy];
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
  } catch (err) {
    console.error(err);
    return json({ error: "calendar unavailable" }, 500);
  }

  return json({ slots });
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
    throw err;
  }
}

async function handleCancel(url: URL, request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await checkRateLimit(env, ip, "cancel", 10, 3600))) {
    return html("<h2>Zu viele Anfragen.</h2>", 429);
  }

  const uid = url.searchParams.get("uid")?.trim();
  if (!uid || !/^[\w-]+$/.test(uid)) {
    return html("<h2>Invalid cancellation link.</h2>", 400);
  }
  await deleteEvent(env, uid);
  return html(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Booking cancelled</title>
<style>body{font-family:sans-serif;max-width:500px;margin:60px auto;padding:20px;color:#2c292d}
a{color:#006e8a}</style></head>
<body>
<h2>Booking cancelled</h2>
<p>Your booking has been removed from the calendar.</p>
<p><a href="https://book.ecke.lt">Book a new time</a></p>
</body></html>`);
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
