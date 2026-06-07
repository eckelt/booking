import type { Env, Interval } from "./types.js";
import { ConflictError } from "./types.js";

const BASE_URL = "https://caldav.fastmail.com";

function calendarUrl(env: Env, calendarName: string): string {
  return `${BASE_URL}/dav/calendars/user/${env.CALDAV_USERNAME}/${calendarName}/`;
}

function authHeader(env: Env): string {
  return "Basic " + btoa(`${env.CALDAV_USERNAME}:${env.CALDAV_PASSWORD}`);
}

function toCalDavDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
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
    const rbody = await res.text().catch(() => "");
    throw new Error(`CalDAV REPORT failed: ${res.status} url=${res.url} www-auth=${res.headers.get("www-authenticate")} body=${rbody.slice(0, 200)}`);
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
  if (!res.ok) {
    const rbody = await res.text().catch(() => "");
    throw new Error(`CalDAV PUT failed: ${res.status} url=${url} body=${rbody.slice(0, 300)}`);
  }
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
    // sv-SE produces "2026-06-08 10:30:00" — strip dashes/colons, replace space with T
    return s.replace(/[-:]/g, "").replace(" ", "T");
  };

  const now = fmt(new Date());
  const dtStart = fmtLocal(params.start);
  const dtEnd = fmtLocal(params.end);

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

// ── XML builders / parsers ──

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
  // Extract a property line by name, returning the full "PROPNAME;params:VALUE" line.
  const getLine = (prop: string): string | null => {
    const m = new RegExp(`^${prop}[;:][^\r\n]*`, "m").exec(ical);
    return m ? m[0] : null;
  };

  const getVal = (line: string): string =>
    line.slice(line.indexOf(":") + 1).trim();

  const statusLine = getLine("STATUS");
  if (statusLine && getVal(statusLine) === "CANCELLED") return null;

  const transpLine = getLine("TRANSP");
  if (transpLine && getVal(transpLine) === "TRANSPARENT") return null;

  const dtStartLine = getLine("DTSTART");
  if (!dtStartLine) return null;

  const start = parseIcalDateLine(dtStartLine);
  if (!start) return null;

  let end: Date | null = null;
  const dtEndLine = getLine("DTEND");
  if (dtEndLine) {
    end = parseIcalDateLine(dtEndLine);
  } else {
    const durLine = getLine("DURATION");
    if (durLine) {
      end = new Date(start.getTime() + parseDuration(getVal(durLine)));
    }
  }

  if (!end) return null;
  return { start, end };
}

// Parse a full iCal property line like:
//   DTSTART;TZID=Europe/Berlin:20260608T103000
//   DTSTART:20260608T103000Z
//   DTSTART:20260608
function parseIcalDateLine(line: string): Date | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;

  const params = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1).trim();

  // UTC datetime: 20260608T103000Z
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
      `T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`
    );
  }

  // All-day date: 20260608
  if (/^\d{8}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  }

  // Local datetime with TZID: DTSTART;TZID=Europe/Berlin:20260608T103000
  if (/^\d{8}T\d{6}$/.test(value)) {
    const tzid = /TZID=([^;:]+)/.exec(params)?.[1] ?? "UTC";
    const localStr =
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
      `T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
    return localToUtc(localStr, tzid);
  }

  return null;
}

// Convert a local datetime string ("2026-06-08T10:30:00") in a given tz to UTC.
function localToUtc(localStr: string, tzid: string): Date {
  // Parse as if UTC, then find the offset that tz has at that approximate time,
  // and correct back to get the true UTC instant.
  const naive = new Date(localStr + "Z");
  const localRepr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tzid,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(naive);
  // sv-SE gives "2026-06-08 12:30:00" (the local time that naive UTC maps to)
  const asUtcMs = new Date(localRepr.replace(" ", "T") + "Z").getTime();
  // offsetMs = how far the tz is from UTC (positive = ahead of UTC)
  const offsetMs = asUtcMs - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

function parseDuration(raw: string): number {
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
