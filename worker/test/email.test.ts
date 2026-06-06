import { describe, it, expect } from "vitest";
import { formatDate, formatTime } from "../src/email.js";

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
