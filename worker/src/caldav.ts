import type { Env, Interval } from "./types.js";
import { ConflictError } from "./types.js";

const BASE_URL = "https://caldav.fastmail.com";

function calendarUrl(env: Env, calendarName: string): string {
  const user = encodeURIComponent(env.CALDAV_USERNAME);
  return `${BASE_URL}/dav/calendars/user/${user}/${calendarName}/`;
}

function authHeader(env: Env): string {
  return "Basic " + btoa(`${env.CALDAV_USERNAME}:${env.CALDAV_PASSWORD}`);
}

function toCalDavDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // e.g. "20260608T090000Z"
}

export async function fetchBusy(
  env: Env,
  calendarName: string,
  rangeStart: Date,
  rangeEnd: Date,
  fetcher: typeof fetch = fetch
): Promise<Interval[]> {
  const body = buildReportXml(rangeStart, rangeEnd);
  const res = await fetcher(calendarUrl(env, calendarName), {
    method: "REPORT",
    headers: {
      Authorization: authHeader(env),
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
    },
    body,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CalDAV REPORT failed: ${res.status} url=${res.url} www-auth=${res.headers.get("www-authenticate")} body=${body.slice(0, 200)}`);
  }

  const xml = await res.text();
  return parseMultiStatusIntervals(xml);
}

export async function putEvent(
  env: Env,
  uid: string,
  ical: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const url = calendarUrl(env, env.CALDAV_CALENDAR_NILS) + `${uid}.ics`;
  const res = await fetcher(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader(env),
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*",
    },
    body: ical,
  });

  if (res.status === 412) throw new ConflictError();
  if (!res.ok) throw new Error(`CalDAV PUT failed: ${res.status}`);
}

export function buildIcal(params: {
  uid: string;
  start: Date;
  end: Date;
  name: string;
  notes: string;
  jitsiUrl: string;
  ownerEmail: string;
  ownerName: string;
  bookerEmail: string;
}): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fmtLocal = (d: Date) => {
    const s = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Berlin",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).format(d);
    return s.replace(/[-: ]/g, "").replace("T", "T");
  };

  const now = fmt(new Date());
  const dtStart = fmtLocal(params.start).replace(" ", "T");
  const dtEnd = fmtLocal(params.end).replace(" ", "T");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//book.ecke.lt//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=Europe/Berlin:${dtStart}`,
    `DTEND;TZID=Europe/Berlin:${dtEnd}`,
    `SUMMARY:Meeting with ${params.name}`,
    `DESCRIPTION:Booked via book.ecke.lt\\nNotes: ${params.notes || "—"}\\nJitsi: ${params.jitsiUrl}`,
    `ORGANIZER;CN=${params.ownerName}:mailto:${params.ownerEmail}`,
    `ATTENDEE;CN=${params.name}:mailto:${params.bookerEmail}`,
    `X-JITSI-URL:${params.jitsiUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ── XML builders / parsers ────────────────────────────────────────────────────

function buildReportXml(start: Date, end: Date): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data>
      <c:comp name="VCALENDAR">
        <c:comp name="VEVENT">
          <c:prop name="DTSTART"/>
          <c:prop name="DTEND"/>
          <c:prop name="DURATION"/>
          <c:prop name="STATUS"/>
          <c:prop name="TRANSP"/>
        </c:comp>
      </c:comp>
    </c:calendar-data>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toCalDavDate(start)}" end="${toCalDavDate(end)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

export function parseMultiStatusIntervals(xml: string): Interval[] {
  const intervals: Interval[] = [];

  // Extract all calendar-data blocks
  const calDataPattern = /<[^:>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*:?calendar-data>/g;
  let match;
  while ((match = calDataPattern.exec(xml)) !== null) {
    const ical = match[1] ?? "";
    const interval = parseVevent(ical);
    if (interval) intervals.push(interval);
  }

  return intervals;
}

function parseVevent(ical: string): Interval | null {
  const get = (prop: string) => {
    const m = new RegExp(`^${prop}[;:][^\r\n]*`, "m").exec(ical);
    return m ? m[0].split(/:/).slice(1).join(":").trim() : null;
  };

  const status = get("STATUS");
  if (status === "CANCELLED") return null;

  const transp = get("TRANSP");
  if (transp === "TRANSPARENT") return null;

  const dtStartRaw = get("DTSTART");
  if (!dtStartRaw) return null;

  const start = parseIcalDate(dtStartRaw);
  if (!start) return null;

  let end: Date | null = null;
  const dtEndRaw = get("DTEND");
  if (dtEndRaw) {
    end = parseIcalDate(dtEndRaw);
  } else {
    const durationRaw = get("DURATION");
    if (durationRaw) {
      end = new Date(start.getTime() + parseDuration(durationRaw));
    }
  }

  if (!end) return null;
  return { start, end };
}

function parseIcalDate(raw: string): Date | null {
  // DATE format: 20260608 → all-day, treat as 00:00 UTC
  if (/^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`);
  }
  // DATETIME UTC: 20260608T090000Z
  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    return new Date(
      `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
    );
  }
  // DATETIME local (TZID handled by server expansion): treat as if UTC for simplicity
  // Fastmail expands to UTC in REPORT responses
  if (/^\d{8}T\d{6}$/.test(raw)) {
    return new Date(
      `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
    );
  }
  return null;
}

function parseDuration(raw: string): number {
  // Simple parser for PT#H#M#S and P#D
  let ms = 0;
  const days = /(\d+)D/.exec(raw);
  const hours = /(\d+)H/.exec(raw);
  const minutes = /(\d+)M/.exec(raw);
  const seconds = /(\d+)S/.exec(raw);
  if (days) ms += parseInt(days[1]!) * 86400000;
  if (hours) ms += parseInt(hours[1]!) * 3600000;
  if (minutes) ms += parseInt(minutes[1]!) * 60000;
  if (seconds) ms += parseInt(seconds[1]!) * 1000;
  return ms;
}
