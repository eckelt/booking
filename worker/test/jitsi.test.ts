import { describe, it, expect } from "vitest";
import { generateJitsiUrl, generateUid } from "../src/jitsi.js";

describe("generateUid", () => {
  it("starts with booking-", () => {
    expect(generateUid()).toMatch(/^booking-/);
  });

  it("generates unique IDs", () => {
    expect(generateUid()).not.toBe(generateUid());
  });
});

describe("generateJitsiUrl", () => {
  it("produces a meet.jit.si URL with the uid", () => {
    const uid = "booking-abc123";
    expect(generateJitsiUrl(uid)).toBe("https://meet.jit.si/booking-abc123");
  });
});
