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

// Reproduces the reported "reschedule creates a second booking instead of
// moving the existing one" incident: does createBooking actually delete the
// old CalDAV event when rescheduleUid is set?
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

  function pickBookableStart(): Date {
    for (let i = 2; i <= 10; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const w = workingDayWindow(d);
      if (w) return w.start;
    }
    throw new Error("no bookable weekday found in range");
  }

  function makeFetcher() {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "REPORT") {
        return new Response(`<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>`, { status: 200 });
      }
      if (method === "PUT") return new Response(null, { status: 201 });
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
  }

  it("deletes the old event when rescheduleUid is set", async () => {
    const req = validateBookingRequest({
      start: pickBookableStart().toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
      rescheduleUid: "old-meeting-uid",
    });
    const fetcher = makeFetcher();

    await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    const deleteCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(1);
    expect(String(deleteCalls[0]![0])).toContain("old-meeting-uid.ics");
  });

  it("does not attempt a delete for a plain (non-reschedule) booking", async () => {
    const req = validateBookingRequest({
      start: pickBookableStart().toISOString(),
      duration: 30,
      name: "Waldemar",
      email: "waldemar@example.com",
    });
    const fetcher = makeFetcher();

    await createBooking(mockEnv, req, fakeCtx, fetcher as unknown as typeof fetch);

    const deleteCalls = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });
});
