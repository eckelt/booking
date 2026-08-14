import type { BookingRequest, BookingResult, Env, Interval } from "./types.js";
import { SlotUnavailableError, ConflictError } from "./types.js";
import { fetchBusy, putEvent, deleteEvent, buildIcal } from "./caldav.js";
import { sendEmails } from "./email.js";
import { generateUid } from "./jitsi.js";
import { generateMeetingNames } from "./title.js";
import type { MeetingName } from "./title.js";
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

  const rescheduleUid = b["rescheduleUid"] !== undefined
    ? String(b["rescheduleUid"]).trim()
    : undefined;
  if (rescheduleUid && !/^[\w-]+$/.test(rescheduleUid)) {
    throw new Error("invalid rescheduleUid");
  }

  const lang = b["lang"] === "en" ? "en" : "de";

  return { start, duration, name, email, notes, rescheduleUid, lang };
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

  // Kick off title generation now so its (multi-second) latency overlaps the
  // CalDAV availability fetch below. generateMeetingNames never rejects.
  const namesPromise = generateMeetingNames(env, {
    name: req.name,
    notes: req.notes ?? "",
    lang: req.lang ?? "de",
  });

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

  const names = await namesPromise;

  // Try each pretty candidate (primary, then adjective variants). If every slug
  // is somehow taken, a short random suffix on the primary is the invisible
  // last resort so the Jitsi room and CalDAV filename stay unique.
  const attempts: MeetingName[] = [
    ...names,
    { title: names[0]!.title, slug: `${names[0]!.slug}-${generateUid().slice(0, 4)}` },
  ];

  let uid = "";
  let title = "";
  for (let i = 0; i < attempts.length; i++) {
    const cand = attempts[i]!;
    const link = `https://join.ecke.lt/${cand.slug}`;
    const ownerJitsiUrl = env.HOST_JOIN_SECRET
      ? `${link}?host=${env.HOST_JOIN_SECRET}`
      : link;
    const icalForOwner = buildIcal({
      uid: cand.slug,
      start,
      end,
      title: cand.title,
      name: req.name,
      notes: req.notes ?? "",
      jitsiUrl: ownerJitsiUrl,
      ownerEmail: env.OWNER_EMAIL,
      ownerName: env.OWNER_NAME,
      bookerEmail: req.email,
    });
    try {
      await putEvent(env, cand.slug, icalForOwner, fetcher);
      uid = cand.slug;
      title = cand.title;
      break;
    } catch (err) {
      if (err instanceof ConflictError && i < attempts.length - 1) continue;
      throw err;
    }
  }

  const jitsiUrl = `https://join.ecke.lt/${uid}`;

  if (req.rescheduleUid) {
    await deleteEvent(env, req.rescheduleUid, fetcher).catch((err) =>
      console.error(`[reschedule] failed to delete old event uid=${req.rescheduleUid} error=${err?.message ?? err}`)
    );
  }

  // Email is best-effort — a failure must not roll back the booking
  const durationPath = req.duration === 60 ? "60min" : "30min";
  const icalForBooker = buildIcal({
    uid,
    start,
    end,
    title,
    name: req.name,
    notes: req.notes ?? "",
    jitsiUrl,
    ownerEmail: env.OWNER_EMAIL,
    ownerName: env.OWNER_NAME,
    bookerEmail: req.email,
  });
  ctx.waitUntil(
    sendEmails(env, {
      uid,
      start,
      end,
      name: req.name,
      bookerEmail: req.email,
      notes: req.notes ?? "",
      jitsiUrl,
      icalAttachment: icalForBooker,
      cancelUrl: `https://book.ecke.lt/api/cancel?uid=${uid}`,
      rescheduleUrl: `https://book.ecke.lt/${durationPath}/?reschedule=${uid}&name=${encodeURIComponent(req.name)}&email=${encodeURIComponent(req.email)}`,
    }).catch((err) => console.error(`[email] FAILED uid=${uid} to=${req.email} error=${err?.message ?? err}`))
  );

  return {
    uid,
    start: start.toISOString(),
    end: end.toISOString(),
    jitsiUrl,
  };
}
