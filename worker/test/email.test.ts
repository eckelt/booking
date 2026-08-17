import { describe, it, expect } from "vitest";
import { formatDate, formatTime, utf8ToBase64 } from "../src/email.js";

// Note: sendEmails uses cloudflare:sockets (TCP) which is not available in Node/Vitest.
// The SMTP logic is tested at the unit level via helpers; integration is verified manually.

describe("formatDate", () => {
  it("formats a date in Europe/Berlin locale", () => {
    const d = new Date("2026-06-08T07:00:00Z"); // 09:00 Berlin
    const result = formatDate(d);
    expect(result).toContain("Monday");
    expect(result).toContain("8");
    expect(result).toContain("June");
    expect(result).toContain("2026");
  });
});

describe("formatTime", () => {
  it("formats time in Europe/Berlin (09:00)", () => {
    const d = new Date("2026-06-08T07:00:00Z"); // 09:00 Berlin (CEST = UTC+2)
    expect(formatTime(d)).toBe("09:00");
  });

  it("formats time in Europe/Berlin (13:30)", () => {
    const d = new Date("2026-06-08T11:30:00Z"); // 13:30 Berlin
    expect(formatTime(d)).toBe("13:30");
  });
});

describe("utf8ToBase64", () => {
  it("round-trips plain ASCII", () => {
    const encoded = utf8ToBase64("hello world");
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe("hello world");
  });

  // Regression: a booking left without notes falls back to an em dash ("—") in
  // the .ics DESCRIPTION (see buildIcal). Plain btoa() throws on that
  // character (outside Latin-1), which silently killed the confirmation email
  // for every notes-less booking.
  it("encodes an em dash without throwing (empty-notes ICS fallback)", () => {
    const ical = "DESCRIPTION:Notes: —\\nName: Philipp Deutscher";
    expect(() => utf8ToBase64(ical)).not.toThrow();
    const encoded = utf8ToBase64(ical);
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe(ical);
  });

  it("round-trips emoji and other astral characters", () => {
    const s = "Termin 🎉 mit Björn";
    const encoded = utf8ToBase64(s);
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe(s);
  });
});
