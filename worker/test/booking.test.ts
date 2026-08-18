import { describe, it, expect, vi } from "vitest";
import { validateBookingRequest, createBooking } from "../src/booking.js";
import { workingDayWindow } from "../src/availability.js";
import type { Env } from "../src/types.js";

describe("validateBookingRequest", () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  it("accepts valid request", () => {
    const req = validateBookingRequest({
      start: future,
      duration: 30,
      name: "Jane Doe",
      email: "jane@example.com",
      notes: "Hi",
    });
    expect(req.name).toBe("Jane Doe");
    expect(req.duration).toBe(30);
  });

  it("accepts duration 60", () => {
    const req = validateBookingRequest({
      start: future,
      duration: 60,
      name: "Jane",
      email: "jane@example.com",
    });
    expect(req.duration).toBe(60);
  });

  it("rejects duration 45", () => {
    expect(() =>
      validateBookingRequest({ start: future, duration: 45, name: "Jane", email: "jane@example.com" })
    ).toThrow("duration");
  });

  it("rejects missing name", () => {
    expect(() =>
      validateBookingRequest({ start: future, duration: 30, name: "", email: "jane@example.com" })
    ).toThrow("name");
  });

  it("rejects invalid email", () => {
    expect(() =>
      validateBookingRequest({ start: future, duration: 30, name: "Jane", email: "notanemail" })
    ).toThrow("email");
  });

  it("rejects past start time", () => {
    expect(() =>
      validateBookingRequest({
        start: new Date(Date.now() - 1000).toISOString(),
        duration: 30,
        name: "Jane",
        email: "jane@example.com",
      })
    ).toThrow("future");
  });

  it("rejects start beyond 14 days", () => {
    const tooFar = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(() =>
      validateBookingRequest({ start: tooFar, duration: 30, name: "Jane", email: "jane@example.com" })
    ).toThrow("future");
  });

  it("rejects invalid date string", () => {
    expect(() =>
      validateBookingRequest({ start: "not-a-date", duration: 30, name: "Jane", email: "jane@example.com" })
    ).toThrow();
  });

  it("truncates notes to 1000 chars", () => {
    const req = validateBookingRequest({
      start: future,
      duration: 30,
      name: "Jane",
      email: "jane@example.com",
      notes: "x".repeat(2000),
    });
    expect(req.notes!.length).toBe(1000);
  });

  it("defaults lang to de and accepts en", () => {
    const de = validateBookingRequest({
      start: future, duration: 30, name: "Jane", email: "jane@example.com",
    });
    expect(de.lang).toBe("de");

    const en = validateBookingRequest({
      start: future, duration: 30, name: "Jane", email: "jane@example.com", lang: "en",
    });
    expect(en.lang).toBe("en");

    const bogus = validateBookingRequest({
      start: future, duration: 30, name: "Jane", email: "jane@example.com", lang: "fr",
    });
    expect(bogus.lang).toBe("de");
  });

  it("defaults aiTitle to true and accepts an explicit opt-out", () => {
    const onByDefault = validateBookingRequest({
      start: future, duration: 30, name: "Jane", email: "jane@example.com",
    });
    expect(onByDefault.aiTitle).toBe(true);

    const optedOut = validateBookingRequest({
      start: future, duration: 30, name: "Jane", email: "jane@example.com", aiTitle: false,
    });
    expect(optedOut.aiTitle).toBe(false);

    const truthyIgnored = validateBookingRequest({
      start: future, duration: 30, name: "Jane", email: "jane@example.com", aiTitle: "false",
    });
    expect(truthyIgnored.aiTitle).toBe(true);
  });
});

// Reschedule should move the existing CalDAV resource in place (same uid,
// same Jitsi room/link) instead of creating a new event and deleting the
// old one — that create-then-delete dance is what produced the reported
// "reschedule creates a second booking" incident.
describe("createBooking — reschedule", () => {
  const mockEnv = {
    OWNER_NAME: "Nils Eckelt",
    OWNER_EMAIL: "nils@ecke.lt",
    CALDAV_USERNAME: "nils@ecke.lt",
    CALDAV_PASSWORD: "secret",
    CALDAV_CALENDAR_NILS: "Nils",
    CALDAV_CALENDAR_OHANA: "Ohana",
    SMTP_USERNAME: "nils@ecke.lt",
    SMTP_PASSWORD: "smtp-secret",
  } as Env;

  const fakeCtx = {
    waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
  } as unknown as ExecutionContext;

  function pickBookableStart(skipDays: number): Date {
    for (let i = skipDays; i <= skipDays + 10; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const w = workingDayWindow(d);
      if (w) return w.start;
    }
    throw new Error("no bookable weekday found in range");
  }

  function icsFor(uid: string, title: string, start: Date, end: Date): string {
    const fmtLocal = (d: Date) => {
      const s = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Berlin",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      }).format(d);
      return s.replace(/[-:]/g, "").replace(" ", "T");
    };
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTART;TZID=Europe/Berlin:${fmtLocal(start)}`,
      `DTEND;TZID=Europe/Berlin:${fmtLocal(end)}`,
      `SUMMARY:${title}`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
  }

  // oldEvent: undefined/"404" ⇒ GET returns 404 (already gone).
  // "error" ⇒ GET returns a 500 (lookup genuinely failed, unknown state).
  // object ⇒ GET returns that event's ICS, and — since it's still on the
  // calendar during the reschedule's own availability check — the REPORT
  // busy query reports it too, exactly like the real Fastmail calendar would.
  // reportBusyOverride optionally reports slightly different timestamps for
  // that same uid via REPORT than what GET returns for it, simulating the
  // two CalDAV code paths not agreeing on the exact instant byte-for-byte.
  function makeFetcher(
    oldEvent?: "404" | "error" | { uid: string; title: string; start: Date; end: Date },
    reportBusyOverride?: { start: Date; end: Date },
  ) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "REPORT") {
        const hasOldEvent = oldEvent && oldEvent !== "404" && oldEvent !== "error";
        const calendarData = hasOldEvent
          ? icsFor(
              oldEvent.uid,
              oldEvent.title,
              reportBusyOverride?.start ?? oldEvent.start,
              reportBusyOverride?.end ?? oldEvent.end,
            )
          : "";
        const body = calendarData
          ? `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><propstat><prop><C:calendar-data>${calendarData}</C:calendar-data></prop></propstat></response></multistatus>`
          : `<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>`;
        return new Response(body, { status: 200 });
      }
      if (method === "GET") {
        if (!oldEvent || oldEvent === "404") return new Response(null, { status: 404 });
        if (oldEvent === "error") return new Response(null, { status: 500 });
        return new Response(icsFor(oldEvent.uid, oldEvent.title, oldEvent.start, oldEvent.end), { status: 200 });
      }
      if (method === "PUT") return new Response(null, { status: 201 });
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
  }

  it("moves the event in place (same uid, no delete) and keeps its title when no new notes are given", async () => {
    const oldStart = pickBookableStart(2);
    const newStart = pickBookableStart(5);
    const req = validateBookingRequest({
      start: newStart.toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
      rescheduleUid: "old-meeting-uid",
    });
    const fetcher = makeFetcher({
      uid: "old-meeting-uid",
      title: "Radtour am Krupunder See",
      start: oldStart,
      end: new Date(oldStart.getTime() + 30 * 60000),
    });

    const result = await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    expect(result.uid).toBe("old-meeting-uid");

    const putCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(putCalls).toHaveLength(1);
    expect(String(putCalls[0]![0])).toContain("old-meeting-uid.ics");
    expect((putCalls[0]![1] as RequestInit).headers).not.toHaveProperty("If-None-Match");
    expect(String((putCalls[0]![1] as RequestInit).body)).toContain("SUMMARY:Radtour am Krupunder See");

    const deleteCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });

  it("does not block the reschedule with the old event's own (buffered) slot on the same day", async () => {
    // Same-day move to the very next 30-min slot: without excluding the old
    // event from the busy check, its own 5-min buffer would overlap this
    // slot and the reschedule would wrongly fail as unavailable.
    const oldStart = pickBookableStart(2);
    const oldEnd = new Date(oldStart.getTime() + 30 * 60000);
    const newStart = oldEnd; // immediately adjacent grid slot

    const req = validateBookingRequest({
      start: newStart.toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
      rescheduleUid: "old-meeting-uid",
    });
    const fetcher = makeFetcher({
      uid: "old-meeting-uid",
      title: "Radtour am Krupunder See",
      start: oldStart,
      end: oldEnd,
    });

    const result = await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    expect(result.uid).toBe("old-meeting-uid");
    expect(result.start).toBe(newStart.toISOString());
  });

  it("still excludes the old event's busy slot even if REPORT reports slightly different timestamps for it than GET (matches by uid, not by timestamp)", async () => {
    const oldStart = pickBookableStart(2);
    const oldEnd = new Date(oldStart.getTime() + 30 * 60000);
    const newStart = oldEnd;

    const req = validateBookingRequest({
      start: newStart.toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
      rescheduleUid: "old-meeting-uid",
    });
    const fetcher = makeFetcher(
      { uid: "old-meeting-uid", title: "Radtour am Krupunder See", start: oldStart, end: oldEnd },
      // REPORT reports the same event a couple of seconds off from what GET
      // says — same uid, timestamps don't match exactly.
      { start: new Date(oldStart.getTime() + 2000), end: new Date(oldEnd.getTime() + 2000) },
    );

    const result = await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    expect(result.uid).toBe("old-meeting-uid");
  });

  it("regenerates the title instead of reusing the old one when new notes are given", async () => {
    const oldStart = pickBookableStart(2);
    const req = validateBookingRequest({
      start: pickBookableStart(5).toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
      notes: "Wir wollen übers Budget sprechen",
      rescheduleUid: "old-meeting-uid",
    });
    const fetcher = makeFetcher({
      uid: "old-meeting-uid",
      title: "Radtour am Krupunder See",
      start: oldStart,
      end: new Date(oldStart.getTime() + 30 * 60000),
    });

    await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    const putCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    const body = String((putCalls[0]![1] as RequestInit).body);
    expect(body).not.toContain("Radtour am Krupunder See");
    expect(body).toContain("SUMMARY:Termin mit Waldemar");
  });

  it("falls back to a fresh booking (new uid, no delete) when the old event is already gone (404)", async () => {
    const req = validateBookingRequest({
      start: pickBookableStart(2).toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
      rescheduleUid: "gone-uid",
    });
    const fetcher = makeFetcher("404");

    const result = await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    expect(result.uid).not.toBe("gone-uid");
    const putCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(putCalls).toHaveLength(1);
    expect((putCalls[0]![1] as RequestInit).headers).toHaveProperty("If-None-Match", "*");

    const deleteCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });

  it("defensively deletes the old uid when the lookup itself fails (not a confirmed 404)", async () => {
    const req = validateBookingRequest({
      start: pickBookableStart(2).toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
      rescheduleUid: "unknown-state-uid",
    });
    const fetcher = makeFetcher("error");

    const result = await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    expect(result.uid).not.toBe("unknown-state-uid");
    const deleteCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(1);
    expect(String(deleteCalls[0]![0])).toContain("unknown-state-uid.ics");
  });

  it("does not look up or delete anything for a plain (non-reschedule) booking", async () => {
    const req = validateBookingRequest({
      start: pickBookableStart(2).toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
    });
    const fetcher = makeFetcher();

    await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    const getCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "GET");
    const deleteCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(getCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });
});
