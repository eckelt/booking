import type { Interval, Slot } from "./types.js";

const TZ = "Europe/Berlin";
const BUFFER_MS = 5 * 60 * 1000;

// [dayOfWeek (0=Sun)]: [startHour, endHour] | null
const WORKING_HOURS: (readonly [number, number] | null)[] = [
  null,        // Sunday
  [9, 17],     // Monday
  [9, 17],     // Tuesday
  [9, 13],     // Wednesday
  [9, 17],     // Thursday
  [9, 13],     // Friday
  null,        // Saturday
];

export function workingDayWindow(date: Date): Interval | null {
  const dow = getLocalDay(date, TZ);
  const hours = WORKING_HOURS[dow];
  if (!hours) return null;

  const [startH, endH] = hours;
  return {
    start: localHour(date, startH, TZ),
    end: localHour(date, endH, TZ),
  };
}

export function applyBuffer(intervals: Interval[], bufferMs = BUFFER_MS): Interval[] {
  return intervals.map((iv) => ({
    start: new Date(iv.start.getTime() - bufferMs),
    end: new Date(iv.end.getTime() + bufferMs),
  }));
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [{ ...sorted[0]! }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) {
        last.end = current.end;
      }
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export function invertIntervals(
  busy: Interval[],
  windowStart: Date,
  windowEnd: Date
): Interval[] {
  const free: Interval[] = [];
  let cursor = windowStart;

  for (const iv of busy) {
    if (iv.start.getTime() > cursor.getTime()) {
      free.push({ start: cursor, end: iv.start });
    }
    if (iv.end.getTime() > cursor.getTime()) {
      cursor = iv.end;
    }
  }

  if (cursor.getTime() < windowEnd.getTime()) {
    free.push({ start: cursor, end: windowEnd });
  }

  return free;
}

export function generateSlots(free: Interval[], durationMs: number): Slot[] {
  const slots: Slot[] = [];
  for (const interval of free) {
    let t = interval.start.getTime();
    while (t + durationMs <= interval.end.getTime()) {
      slots.push({ start: new Date(t), end: new Date(t + durationMs) });
      t += durationMs;
    }
  }
  return slots;
}

export function computeSlots(
  busyIntervals: Interval[],
  windowStart: Date,
  windowEnd: Date,
  durationMs: number
): Slot[] {
  const buffered = applyBuffer(busyIntervals);
  const merged = mergeIntervals(buffered);

  // Clamp busy intervals to the window so buffer doesn't push outside
  const clamped = merged
    .map((iv) => ({
      start: new Date(Math.max(iv.start.getTime(), windowStart.getTime())),
      end: new Date(Math.min(iv.end.getTime(), windowEnd.getTime())),
    }))
    .filter((iv) => iv.start.getTime() < iv.end.getTime());

  const free = invertIntervals(clamped, windowStart, windowEnd);
  return generateSlots(free, durationMs);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getLocalDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
    .formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[weekday] ?? 0;
}

function localHour(date: Date, hour: number, tz: string): Date {
  // Build ISO string for midnight local then add hours
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const localDate = fmt.format(date); // "2026-06-08"
  return new Date(`${localDate}T${String(hour).padStart(2, "0")}:00:00`
    // Interpret as local time by appending timezone offset
    + getOffsetString(new Date(`${localDate}T${String(hour).padStart(2, "0")}:00:00`), tz));
}

function getOffsetString(approxDate: Date, tz: string): string {
  // Use Intl to determine the UTC offset for a given tz at a given date
  const utcMs = approxDate.getTime();
  const localStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(new Date(utcMs));
  // sv-SE gives "2026-06-08 09:00:00"
  const localMs = new Date(localStr.replace(" ", "T") + "Z").getTime();
  const offsetMs = localMs - utcMs;
  const offsetMin = Math.round(offsetMs / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(absMin / 60)).padStart(2, "0")}:${String(absMin % 60).padStart(2, "0")}`;
}
