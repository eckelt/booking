import { describe, it, expect, vi } from "vitest";
import { fetchBusy, parseMultiStatusIntervals, buildIcal } from "../src/caldav.js";
import { ConflictError } from "../src/types.js";
import { putEvent } from "../src/caldav.js";
import type { Env } from "../src/types.js";

const mockEnv: Env = {
  OWNER_NAME: "Nils Eckelt",
  OWNER_EMAIL: "nils@ecke.lt",
  CALDAV_USERNAME: "nils@ecke.lt",
  CALDAV_PASSWORD: "secret",
  CALDAV_CALENDAR_NILS: "Nils",
  CALDAV_CALENDAR_OHANA: "Ohana",
  SMTP_USERNAME: "nils@ecke.lt",
  SMTP_PASSWORD: "smtp-secret",
};

function makeMultiStatus(calendarData: string): string {
  return `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <propstat>
      <status>HTTP/1.1 200 OK</status>
      <prop>
        <C:calendar-data>${calendarData}</C:calendar-data>
      </prop>
    </propstat>
  </response>
</multistatus>`;
}

describe("parseMultiStatusIntervals", () => {
  it("parses a normal VEVENT", () => {
    const ical = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260608T070000Z\r\nDTEND:20260608T073000Z\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const intervals = parseMultiStatusIntervals(makeMultiStatus(ical));
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.start).toEqual(new Date("2026-06-08T07:00:00Z"));
    expect(intervals[0]!.end).toEqual(new Date("2026-06-08T07:30:00Z"));
  });

  it("ignores CANCELLED events", () => {
    const ical = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260608T070000Z\r\nDTEND:20260608T073000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    expect(parseMultiStatusIntervals(makeMultiStatus(ical))).toHaveLength(0);
  });

  it("ignores TRANSPARENT events", () => {
    const ical = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260608T070000Z\r\nDTEND:20260608T073000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    expect(parseMultiStatusIntervals(makeMultiStatus(ical))).toHaveLength(0);
  });

  it("handles all-day DATE events as blocking full day UTC", () => {
    const ical = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260608\r\nDTEND:20260609\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const intervals = parseMultiStatusIntervals(makeMultiStatus(ical));
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.start).toEqual(new Date("2026-06-08T00:00:00Z"));
  });

  it("derives end from DURATION when DTEND is missing", () => {
    const ical = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260608T070000Z\r\nDURATION:PT30M\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const intervals = parseMultiStatusIntervals(makeMultiStatus(ical));
    expect(intervals[0]!.end).toEqual(new Date("2026-06-08T07:30:00Z"));
  });

  it("returns empty array for empty response", () => {
    expect(parseMultiStatusIntervals("<multistatus></multistatus>")).toHaveLength(0);
  });
});

describe("fetchBusy", () => {
  it("calls REPORT with correct URL and auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("<multistatus></multistatus>", { status: 207 })
    );
    await fetchBusy(
      mockEnv,
      "Nils",
      new Date("2026-06-08T00:00:00Z"),
      new Date("2026-06-08T23:59:59Z"),
      mockFetch
    );
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("caldav.fastmail.com");
    expect(url).toContain("Nils");
    expect((options.headers as Record<string, string>)["Authorization"]).toMatch(/^Basic /);
    expect(options.method).toBe("REPORT");
  });

  it("throws on non-207 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await expect(
      fetchBusy(mockEnv, "Nils", new Date(), new Date(), mockFetch)
    ).rejects.toThrow();
  });
});

describe("putEvent", () => {
  it("PUTs with If-None-Match: * header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    await putEvent(mockEnv, "booking-test-uid", "BEGIN:VCALENDAR...", mockFetch);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["If-None-Match"]).toBe("*");
  });

  it("throws ConflictError on 412", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("", { status: 412 }));
    await expect(
      putEvent(mockEnv, "uid", "ical", mockFetch)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("throws on other error status", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await expect(
      putEvent(mockEnv, "uid", "ical", mockFetch)
    ).rejects.toThrow("500");
  });
});

describe("buildIcal", () => {
  it("includes required iCal fields", () => {
    const ical = buildIcal({
      uid: "booking-123",
      start: new Date("2026-06-08T07:00:00Z"),
      end: new Date("2026-06-08T07:30:00Z"),
      name: "Jane Doe",
      notes: "Hello",
      jitsiUrl: "https://meet.jit.si/booking-123",
      ownerEmail: "nils@ecke.lt",
      ownerName: "Nils Eckelt",
      bookerEmail: "jane@example.com",
    });
    expect(ical).toContain("BEGIN:VCALENDAR");
    expect(ical).toContain("UID:booking-123");
    expect(ical).toContain("SUMMARY:Meeting with Jane Doe");
    expect(ical).toContain("DTSTART;TZID=Europe/Berlin:");
    expect(ical).toContain("X-JITSI-URL:https://meet.jit.si/booking-123");
    expect(ical).toContain("END:VEVENT");
  });
});
