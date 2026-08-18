import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src/index.js";
import { workingDayWindow } from "../src/availability.js";
import type { Env } from "../src/types.js";

// Reproduces the reported incident: /api/slots offered "09:35" as a bookable
// slot during a reschedule (only a valid slot boundary because the OLD event
// being moved was still counted as busy, and its 5-minute buffer pushed the
// next free gap to start at 09:35). /api/book then correctly excludes that
// old event — which shifts the slot grid back to a plain 09:00 start — so
// the exact "09:35" the booker picked no longer matches any slot and the
// booking fails as "no longer available", even though nothing is actually
// wrong. Fix: /api/slots must exclude the same old event too, so it never
// offers a slot boundary that only existed because of it.
describe("handleSlots + createBooking — reschedule slot-grid consistency", () => {
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

  function icsFor(uid: string, start: Date, end: Date): string {
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
      "SUMMARY:Termin mit Waldemar",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(oldUid: string, oldStart: Date, oldEnd: Date) {
    const calendarData = icsFor(oldUid, oldStart, oldEnd);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "REPORT") {
        // The old event only lives on the owner's own calendar.
        const includeOldEvent = url.includes("/Nils/");
        const body = includeOldEvent
          ? `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><propstat><prop><C:calendar-data>${calendarData}</C:calendar-data></prop></propstat></response></multistatus>`
          : `<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>`;
        return new Response(body, { status: 200 });
      }
      if (method === "GET") {
        return url.includes(`${oldUid}.ics`)
          ? new Response(calendarData, { status: 200 })
          : new Response(null, { status: 404 });
      }
      if (method === "PUT") return new Response(null, { status: 201 });
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch ${method} ${url}`);
    }));
  }

  it("only offers the old event's buffer-anchored slot when NOT excluding it (reproduces the bug)", async () => {
    const oldStart = pickBookableStart(2);
    const oldEnd = new Date(oldStart.getTime() + 30 * 60000);
    stubFetch("old-meeting-uid", oldStart, oldEnd);

    const dayIso = oldStart.toISOString().slice(0, 10);
    const req = new Request(`https://book.ecke.lt/api/slots?duration=30&from=${dayIso}&to=${dayIso}`);
    const res = await worker.fetch(req, mockEnv, fakeCtx);
    const { slots } = await res.json() as { slots: { start: string }[] };

    const startTimes = slots.map((s) => new Date(s.start).getTime());
    expect(startTimes).not.toContain(oldStart.getTime()); // 09:00 is genuinely busy
  });

  it("excludes the old event when ?reschedule= is set, so the slot grid matches what /api/book will accept", async () => {
    const oldStart = pickBookableStart(2);
    const oldEnd = new Date(oldStart.getTime() + 30 * 60000);
    stubFetch("old-meeting-uid", oldStart, oldEnd);

    const dayIso = oldStart.toISOString().slice(0, 10);
    const req = new Request(
      `https://book.ecke.lt/api/slots?duration=30&from=${dayIso}&to=${dayIso}&reschedule=old-meeting-uid`
    );
    const res = await worker.fetch(req, mockEnv, fakeCtx);
    const { slots } = await res.json() as { slots: { start: string }[] };

    const startTimes = slots.map((s) => new Date(s.start).getTime());
    // With the old event excluded, its own original slot is offered again.
    expect(startTimes).toContain(oldStart.getTime());
  });

  it("end-to-end: a slot offered by /api/slots?reschedule= is actually accepted by /api/book", async () => {
    const oldStart = pickBookableStart(2);
    const oldEnd = new Date(oldStart.getTime() + 30 * 60000);
    stubFetch("old-meeting-uid", oldStart, oldEnd);

    const dayIso = oldStart.toISOString().slice(0, 10);
    const slotsReq = new Request(
      `https://book.ecke.lt/api/slots?duration=30&from=${dayIso}&to=${dayIso}&reschedule=old-meeting-uid`
    );
    const slotsRes = await worker.fetch(slotsReq, mockEnv, fakeCtx);
    const { slots } = await slotsRes.json() as { slots: { start: string; end: string }[] };
    const picked = slots[0]!;

    const bookReq = new Request("https://book.ecke.lt/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duration: 30,
        start: picked.start,
        name: "Waldemar",
        email: "waldemar@example.com",
        rescheduleUid: "old-meeting-uid",
      }),
    });
    const bookRes = await worker.fetch(bookReq, mockEnv, fakeCtx);
    const bookBody = await bookRes.json() as { error?: string; uid?: string };

    expect(bookRes.status).toBe(201);
    expect(bookBody.error).toBeUndefined();
    expect(bookBody.uid).toBe("old-meeting-uid");
  });
});
