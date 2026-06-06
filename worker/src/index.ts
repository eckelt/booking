import type { Env, Interval } from "./types.js";
import { SlotUnavailableError } from "./types.js";
import { fetchBusy } from "./caldav.js";
import { workingDayWindow, computeSlots } from "./availability.js";
import { validateBookingRequest, createBooking } from "./booking.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://book.ecke.lt",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === "/api/slots" && request.method === "GET") {
        return await handleSlots(url, env);
      }
      if (url.pathname === "/api/book" && request.method === "POST") {
        return await handleBook(request, env);
      }
      if (url.pathname === "/api/debug-discover" && request.method === "GET") {
        return await handleDiscover(env);
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "internal error", detail: String(err) }, 500);
    }
  },
};

async function handleDiscover(env: Env): Promise<Response> {
  const user = encodeURIComponent(env.CALDAV_USERNAME);
  const auth = "Basic " + btoa(`${env.CALDAV_USERNAME}:${env.CALDAV_PASSWORD}`);

  const homeUrl = `https://caldav.fastmail.com/dav/calendars/user/${user}/`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

  const res = await fetch(homeUrl, {
    method: "PROPFIND",
    headers: {
      Authorization: auth,
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
    },
    body,
  });

  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, url: homeUrl, body: text }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
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
    return json({ error: "calendar unavailable", detail: String(err) }, 500);
  }

  return json({ slots });
}

async function handleBook(request: Request, env: Env): Promise<Response> {
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
    const result = await createBooking(env, req);
    return json(result, 201);
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return json({ error: "slot no longer available" }, 409);
    }
    throw err;
  }
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
