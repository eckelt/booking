import { describe, it, expect } from "vitest";
import {
  applyBuffer,
  mergeIntervals,
  invertIntervals,
  generateSlots,
  computeSlots,
  workingDayWindow,
} from "../src/availability.js";
import type { Interval } from "../src/types.js";

const MS = (min: number) => min * 60 * 1000;
const D = (iso: string) => new Date(iso);

// Monday 2026-06-08 in Europe/Berlin
const MON = D("2026-06-08T00:00:00Z");
// Wednesday 2026-06-10
const WED = D("2026-06-10T00:00:00Z");
// Saturday 2026-06-13
const SAT = D("2026-06-13T00:00:00Z");

describe("workingDayWindow", () => {
  it("returns 9-17 for Monday", () => {
    const w = workingDayWindow(MON);
    expect(w).not.toBeNull();
    expect(w!.start.getUTCHours()).toBe(7); // 09:00 Berlin = 07:00 UTC in summer
    expect(w!.end.getUTCHours()).toBe(15);  // 17:00 Berlin = 15:00 UTC in summer
  });

  it("returns 9-13 for Wednesday", () => {
    const w = workingDayWindow(WED);
    expect(w).not.toBeNull();
    const durationMs = w!.end.getTime() - w!.start.getTime();
    expect(durationMs).toBe(MS(4 * 60)); // 4 hours
  });

  it("returns null for Saturday", () => {
    expect(workingDayWindow(SAT)).toBeNull();
  });

  it("returns null for Sunday", () => {
    const sun = D("2026-06-14T00:00:00Z");
    expect(workingDayWindow(sun)).toBeNull();
  });
});

describe("applyBuffer", () => {
  it("expands each interval by buffer on both sides", () => {
    const iv: Interval = { start: D("2026-06-08T10:00:00Z"), end: D("2026-06-08T10:30:00Z") };
    const [result] = applyBuffer([iv], MS(5));
    expect(result!.start.getTime()).toBe(D("2026-06-08T09:55:00Z").getTime());
    expect(result!.end.getTime()).toBe(D("2026-06-08T10:35:00Z").getTime());
  });

  it("returns empty array for empty input", () => {
    expect(applyBuffer([])).toEqual([]);
  });
});

describe("mergeIntervals", () => {
  it("merges overlapping intervals", () => {
    const a: Interval = { start: D("2026-06-08T09:00:00Z"), end: D("2026-06-08T10:00:00Z") };
    const b: Interval = { start: D("2026-06-08T09:30:00Z"), end: D("2026-06-08T11:00:00Z") };
    const merged = mergeIntervals([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.start).toEqual(a.start);
    expect(merged[0]!.end).toEqual(b.end);
  });

  it("keeps non-overlapping intervals separate", () => {
    const a: Interval = { start: D("2026-06-08T09:00:00Z"), end: D("2026-06-08T09:30:00Z") };
    const b: Interval = { start: D("2026-06-08T10:00:00Z"), end: D("2026-06-08T10:30:00Z") };
    expect(mergeIntervals([a, b])).toHaveLength(2);
  });

  it("merges adjacent intervals (touching endpoints)", () => {
    const a: Interval = { start: D("2026-06-08T09:00:00Z"), end: D("2026-06-08T09:30:00Z") };
    const b: Interval = { start: D("2026-06-08T09:30:00Z"), end: D("2026-06-08T10:00:00Z") };
    expect(mergeIntervals([a, b])).toHaveLength(1);
  });

  it("handles unsorted input", () => {
    const a: Interval = { start: D("2026-06-08T10:00:00Z"), end: D("2026-06-08T11:00:00Z") };
    const b: Interval = { start: D("2026-06-08T09:00:00Z"), end: D("2026-06-08T09:30:00Z") };
    const merged = mergeIntervals([a, b]);
    expect(merged[0]!.start).toEqual(b.start);
  });
});

describe("invertIntervals", () => {
  it("returns full window when no busy intervals", () => {
    const ws = D("2026-06-08T07:00:00Z");
    const we = D("2026-06-08T15:00:00Z");
    const free = invertIntervals([], ws, we);
    expect(free).toHaveLength(1);
    expect(free[0]!.start).toEqual(ws);
    expect(free[0]!.end).toEqual(we);
  });

  it("splits window around a busy interval", () => {
    const ws = D("2026-06-08T07:00:00Z");
    const we = D("2026-06-08T15:00:00Z");
    const busy: Interval = { start: D("2026-06-08T09:00:00Z"), end: D("2026-06-08T10:00:00Z") };
    const free = invertIntervals([busy], ws, we);
    expect(free).toHaveLength(2);
    expect(free[0]!.end).toEqual(busy.start);
    expect(free[1]!.start).toEqual(busy.end);
  });

  it("returns empty when entire window is busy", () => {
    const ws = D("2026-06-08T07:00:00Z");
    const we = D("2026-06-08T15:00:00Z");
    const busy: Interval = { start: ws, end: we };
    expect(invertIntervals([busy], ws, we)).toHaveLength(0);
  });
});

describe("generateSlots", () => {
  it("generates slots filling a free interval exactly", () => {
    const free: Interval[] = [{
      start: D("2026-06-08T07:00:00Z"),
      end: D("2026-06-08T08:30:00Z"),
    }];
    const slots = generateSlots(free, MS(30));
    expect(slots).toHaveLength(3);
    expect(slots[0]!.start).toEqual(D("2026-06-08T07:00:00Z"));
    expect(slots[2]!.end).toEqual(D("2026-06-08T08:30:00Z"));
  });

  it("excludes partial slots at end of interval", () => {
    // 90 min window, 60 min slot → 1 slot, 30 min leftover
    const free: Interval[] = [{
      start: D("2026-06-08T07:00:00Z"),
      end: D("2026-06-08T08:30:00Z"),
    }];
    const slots = generateSlots(free, MS(60));
    expect(slots).toHaveLength(1);
  });

  it("includes slot when end exactly matches interval end", () => {
    const free: Interval[] = [{
      start: D("2026-06-08T07:00:00Z"),
      end: D("2026-06-08T08:00:00Z"),
    }];
    const slots = generateSlots(free, MS(60));
    expect(slots).toHaveLength(1);
    expect(slots[0]!.end).toEqual(D("2026-06-08T08:00:00Z"));
  });
});

describe("computeSlots — integration", () => {
  it("empty calendar on Monday yields slots 09:00-16:30 (30min)", () => {
    const w = workingDayWindow(MON)!;
    const slots = computeSlots([], w.start, w.end, MS(30));
    // 9:00-17:00 = 8h = 480min / 30 = 16 slots
    expect(slots).toHaveLength(16);
    expect(slots[0]!.start.getTime()).toBe(w.start.getTime());
    expect(slots[15]!.end.getTime()).toBe(w.end.getTime());
  });

  it("meeting 09:00-09:30 → first slot at 09:35 (with 5min buffer)", () => {
    const w = workingDayWindow(MON)!;
    const busy: Interval = { start: w.start, end: new Date(w.start.getTime() + MS(30)) };
    const slots = computeSlots([busy], w.start, w.end, MS(30));
    // After buffer: 08:55-09:35 blocked → first slot at 09:35
    expect(slots[0]!.start.getTime()).toBe(new Date(w.start.getTime() + MS(35)).getTime());
  });

  it("Wednesday short day: last 30-min slot starts at 12:30", () => {
    const w = workingDayWindow(WED)!;
    const slots = computeSlots([], w.start, w.end, MS(30));
    const last = slots[slots.length - 1]!;
    // 09:00 + 3.5h = 12:30 start, 13:00 end
    expect(last.end.getTime()).toBe(w.end.getTime());
  });

  it("two adjacent meetings with <5min gap treated as one block", () => {
    const w = workingDayWindow(MON)!;
    // 09:00-09:30 and 09:32-10:00 → gap 2min < buffer
    const busy: Interval[] = [
      { start: w.start, end: new Date(w.start.getTime() + MS(30)) },
      { start: new Date(w.start.getTime() + MS(32)), end: new Date(w.start.getTime() + MS(60)) },
    ];
    const slots = computeSlots(busy, w.start, w.end, MS(30));
    // Buffer around first: -5min to +35min, buffer around second: +27min to +65min → merged
    // First free slot starts at 65min after window start
    expect(slots[0]!.start.getTime()).toBeGreaterThan(new Date(w.start.getTime() + MS(60)).getTime());
  });

  it("full calendar returns no slots", () => {
    const w = workingDayWindow(MON)!;
    const busy: Interval = { start: w.start, end: w.end };
    expect(computeSlots([busy], w.start, w.end, MS(30))).toHaveLength(0);
  });

  it("60-min slot on Wednesday: last slot starts 12:00", () => {
    const w = workingDayWindow(WED)!;
    const slots = computeSlots([], w.start, w.end, MS(60));
    const last = slots[slots.length - 1]!;
    expect(last.end.getTime()).toBe(w.end.getTime());
    const startMin = (last.start.getTime() - w.start.getTime()) / MS(1);
    expect(startMin).toBe(180); // 3h after 09:00 = 12:00
  });
});
