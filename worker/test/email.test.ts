import { describe, it, expect, vi } from "vitest";
import {
  formatDate,
  formatTime,
  utf8ToBase64,
  wrapBase64,
  dotStuff,
  buildRawMessage,
  withRetry,
} from "../src/email.js";

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

describe("wrapBase64", () => {
  it("wraps at 76 chars with CRLF and stays decodable", () => {
    const original = "x".repeat(500);
    const wrapped = wrapBase64(utf8ToBase64(original));
    const physicalLines = wrapped.split("\r\n");
    expect(physicalLines.length).toBeGreaterThan(1);
    expect(Math.max(...physicalLines.map((l) => l.length))).toBeLessThanOrEqual(76);
    expect(Buffer.from(wrapped.replace(/\r\n/g, ""), "base64").toString("utf-8")).toBe(original);
  });

  it("leaves a short blob on a single line", () => {
    expect(wrapBase64("YWJj")).toBe("YWJj");
  });
});

describe("dotStuff", () => {
  it("doubles a leading dot on any line and nothing else", () => {
    expect(dotStuff(".hidden\r\nplain\r\n.also")).toBe("..hidden\r\nplain\r\n..also");
    expect(dotStuff("no dots here\r\nend")).toBe("no dots here\r\nend");
  });
});

describe("buildRawMessage", () => {
  const bookingIcs = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//book.ecke.lt//Booking//EN",
    "METHOD:PUBLISH", "BEGIN:VEVENT", "UID:sync-jane",
    `DESCRIPTION:Notes: ${"a very long note ".repeat(40)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Meeting", "TRIGGER:-PT10M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");

  it("keeps every line within the SMTP 1000-octet limit even with a bulky .ics", () => {
    const raw = buildRawMessage({
      from: "Nils Eckelt <nils@ecke.lt>",
      to: "Jane Doe <jane@example.com>",
      subject: "Booking confirmed",
      text: "plain body",
      html: "<p>html body</p>",
      icsAttachment: { filename: "booking.ics", content: bookingIcs },
    });
    for (const line of raw.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
    // The attachment survives a round-trip once the base64 is de-wrapped.
    const b64 = raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[1]!.split("\r\n--")[0]!;
    expect(Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf-8")).toBe(bookingIcs);
  });
});

describe("withRetry", () => {
  it("retries a failing call and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    });
    await expect(withRetry(fn, 3)).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws the last error when every attempt fails", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });
    await expect(withRetry(fn, 2)).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
