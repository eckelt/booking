import type { BookingRequest, BookingResult, Env, Interval } from "./types.js";
import { SlotUnavailableError } from "./types.js";
import { fetchBusy, putEvent, buildIcal } from "./caldav.js";
import { sendEmails } from "./email.js";
import { generateUid, generateJitsiUrl } from "./jitsi.js";
import { computeSlots, workingDayWindow } from "./availability.js";

const MAX_DAYS = 14;
const SUPPORTED_DURATIONS = [30, 60] as const;

export function validateBookingRequest(body: unknown): BookingRequest {
  if (!body || typeof body !== "object") throw new Error("invalid body");
  const b = body as Record<string, unknown>;

  const duration = Number(b["duration"]);
  if (!SUPPORTED_DURATIONS.includes(duration as 30 | 60)) {
    throw new Error("duration must be 30 or 60");
  }

  const start = String(b["start"] ?? "");
  const startDate = new Date(start);
  if (isNaN(startDate.getTime())) throw new Error("invalid start time");

  const now = new Date();
  if (startDate <= now) throw new Error("start must be in the future");

  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS);
  if (startDate > maxDate) throw new Error("start is too far in the future");

  const name = String(b["name"] ?? "").trim();
  if (!name || name.length > 100) throw new Error("name is required and must be ≤100 chars");

  const email = String(b["email"] ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid email");

  const notes = String(b["notes"] ?? "").slice(0, 1000);

  return { start, duration, name, email, notes };
}

export async function createBooking(
  env: Env,
  req: BookingRequest,
  ctx: ExecutionContext,
  fetcher: typeof fetch = fetch
): Promise<BookingResult> {
  const start = new Date(req.start);
  const durationMs = req.duration * 60 * 1000;
  const end = new Date(start.getTime() + durationMs);

  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const [nilsBusy, ohanaBusy] = await Promise.all([
    fetchBusy(env, env.CALDAV_CALENDAR_NILS, dayStart, dayEnd, fetcher),
    fetchBusy(env, env.CALDAV_CALENDAR_OHANA, dayStart, dayEnd, fetcher),
  ]);

  const allBusy: Interval[] = [...nilsBusy, ...ohanaBusy];
  const window = workingDayWindow(start);
  if (!window) throw new SlotUnavailableError();

  const slots = computeSlots(allBusy, window.start, window.end, durationMs);
  const slotAvailable = slots.some(
    (s) => s.start.getTime() === start.getTime() && s.end.getTime() === end.getTime()
  );
  if (!slotAvailable) throw new SlotUnavailableError();

  const uid = generateUid();
  const jitsiUrl = generateJitsiUrl(uid);

  const ical = buildIcal({
    uid,
    start,
    end,
    name: req.name,
    notes: req.notes ?? "",
    jitsiUrl,
  });

  await putEvent(env, uid, ical, fetcher);

  // Email is best-effort — a failure must not roll back the booking
  const durationPath = req.duration === 60 ? "60min" : "30min";
  ctx.waitUntil(
    sendEmails(env, {
      uid,
      start,
      end,
      name: req.name,
      bookerEmail: req.email,
      notes: req.notes ?? "",
      jitsiUrl,
      icalAttachment: ical,
      cancelUrl: `https://book.ecke.lt/api/cancel?uid=${uid}`,
      rescheduleUrl: `https://book.ecke.lt/${durationPath}/`,
    }).catch((err) => console.error(`[email] FAILED uid=${uid} to=${req.email} error=${err?.message ?? err}`))
  );

  return {
    uid,
    start: start.toISOString(),
    end: end.toISOString(),
    jitsiUrl,
  };
}
