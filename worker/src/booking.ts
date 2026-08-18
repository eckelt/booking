import type { BookingRequest, BookingResult, Env, Interval } from "./types.js";
import { SlotUnavailableError, ConflictError } from "./types.js";
import { fetchBusy, putEvent, deleteEvent, getEvent, buildIcal } from "./caldav.js";
import { sendEmails } from "./email.js";
import { generateUid } from "./jitsi.js";
import { generateMeetingNames, fallbackNames } from "./title.js";
import type { MeetingName } from "./title.js";
import { computeSlots, workingDayWindow, excludeMovingEvent } from "./availability.js";

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

  const aiTitle = b["aiTitle"] !== false;

  return { start, duration, name, email, notes, rescheduleUid, lang, aiTitle };
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

  // A reschedule looks up its existing event by the uid from the link so the
  // move can reuse that same CalDAV resource — same uid, same Jitsi room/link
  // — instead of creating a new event and deleting the old one. A lookup
  // failure (including "already gone") just falls back to a fresh booking
  // below, so a booking never fails on this.
  let oldEventLookupFailed = false;
  const oldEvent = req.rescheduleUid
    ? await getEvent(env, req.rescheduleUid, fetcher).catch((err) => {
        oldEventLookupFailed = true;
        console.error(`[reschedule] failed to look up old event uid=${req.rescheduleUid} error=${err?.message ?? err}`);
        return null;
      })
    : null;

  // Kick off title generation now so its latency overlaps the CalDAV
  // availability fetch below. generateMeetingNames never rejects. A booker
  // who opted out of AI title generation skips the model call entirely.
  const namesPromise = req.aiTitle === false
    ? Promise.resolve(fallbackNames(req.name, req.lang ?? "de"))
    : generateMeetingNames(
        env,
        { name: req.name, notes: req.notes ?? "", lang: req.lang ?? "de" },
        fetcher,
      );

  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const [nilsBusy, ohanaBusy] = await Promise.all([
    fetchBusy(env, env.CALDAV_CALENDAR_NILS, dayStart, dayEnd, fetcher),
    fetchBusy(env, env.CALDAV_CALENDAR_OHANA, dayStart, dayEnd, fetcher),
  ]);

  const allBusy: Interval[] = excludeMovingEvent(
    [...nilsBusy, ...ohanaBusy],
    req.rescheduleUid,
    oldEvent,
  );

  const window = workingDayWindow(start);
  if (!window) throw new SlotUnavailableError();

  const slots = computeSlots(allBusy, window.start, window.end, durationMs);
  const slotAvailable = slots.some(
    (s) => s.start.getTime() === start.getTime() && s.end.getTime() === end.getTime()
  );
  if (!slotAvailable) throw new SlotUnavailableError();

  const names = await namesPromise;

  let uid = "";
  let title = "";

  if (oldEvent) {
    // True move: overwrite the same resource in place. Keep the existing
    // title unless the booker gave new notes to generate a fresh one from.
    uid = req.rescheduleUid!;
    title = (req.notes?.trim() ? names[0]!.title : oldEvent.title) || names[0]!.title;
    const link = `https://join.ecke.lt/${uid}`;
    const ownerJitsiUrl = env.HOST_JOIN_SECRET ? `${link}?host=${env.HOST_JOIN_SECRET}` : link;
    const icalForOwner = buildIcal({
      uid,
      start,
      end,
      title,
      name: req.name,
      notes: req.notes ?? "",
      jitsiUrl: ownerJitsiUrl,
      ownerEmail: env.OWNER_EMAIL,
      ownerName: env.OWNER_NAME,
      bookerEmail: req.email,
    });
    await putEvent(env, uid, icalForOwner, fetcher, { overwrite: true });
  } else {
    // Brand-new booking (or a reschedule whose target already vanished) — try
    // each pretty candidate (primary, then adjective variants). If every slug
    // is somehow taken, a short random suffix on the primary is the invisible
    // last resort so the Jitsi room and CalDAV filename stay unique.
    const attempts: MeetingName[] = [
      ...names,
      { title: names[0]!.title, slug: `${names[0]!.slug}-${generateUid().slice(0, 4)}` },
    ];
    for (let i = 0; i < attempts.length; i++) {
      const cand = attempts[i]!;
      const link = `https://join.ecke.lt/${cand.slug}`;
      const ownerJitsiUrl = env.HOST_JOIN_SECRET ? `${link}?host=${env.HOST_JOIN_SECRET}` : link;
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

    if (req.rescheduleUid && oldEventLookupFailed) {
      // Lookup failed for an unknown reason (not a confirmed 404), so the old
      // event might still exist — clean it up defensively rather than risk a
      // silent duplicate. Harmless no-op if it's actually already gone.
      await deleteEvent(env, req.rescheduleUid, fetcher).catch((err) =>
        console.error(`[reschedule] cleanup delete failed uid=${req.rescheduleUid} error=${err?.message ?? err}`)
      );
    }
  }

  const jitsiUrl = `https://join.ecke.lt/${uid}`;

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
