import { describe, it, expect } from "vitest";
import { validateBookingRequest } from "../src/booking.js";

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
});
