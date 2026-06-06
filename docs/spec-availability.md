# Availability Spec

## Working Hours (Europe/Berlin)

| Day | Window |
|---|---|
| Monday | 09:00 – 17:00 |
| Tuesday | 09:00 – 17:00 |
| Wednesday | 09:00 – 13:00 |
| Thursday | 09:00 – 17:00 |
| Friday | 09:00 – 13:00 |
| Saturday | closed |
| Sunday | closed |

## Constraints

- **Max horizon**: slots are only offered up to 14 calendar days from today (today inclusive).
- **Min horizon**: slots in the past (before "now") are never offered. Partial current days use actual current time as the floor.
- **Buffer**: 5 minutes added before AND after every existing event in the busy calendars. If a meeting runs 10:00–10:30, the blocked window is 09:55–10:35.
- **Calendars checked**: `Nils` and `Ohana` on the Fastmail account. Any VEVENT in either calendar blocks time.

## Slot Generation Algorithm

```
for each working day D in [today, today+14]:
  window_start = max(working_day_start(D), now)   // handles today
  window_end   = working_day_end(D)

  busy = fetch_busy_intervals(D, "Nils") ∪ fetch_busy_intervals(D, "Ohana")
  busy = apply_buffer(busy, 5 min)
  busy = merge_overlapping(busy)

  free = invert(busy, window_start, window_end)

  for each free interval F:
    t = F.start
    while t + duration ≤ F.end:
      emit slot(t, t + duration)
      t = t + duration          // advance by slot length, NOT by fixed grid
```

### Key design choices

**No global grid.** Slots start at `window_start` and advance by `duration` within each free interval independently. This means:
- After a buffer-adjusted busy interval, the next slot starts exactly at the end of that busy window — not at the next :00 or :30 on the clock.
- Example: meeting 10:00–10:30 → buffer block 09:55–10:35 → next 30-min slot starts 10:35, then 11:05, etc.

**Buffer symmetry.** Both the start and end of each event are padded. This prevents back-to-back bookings without travel/reset time.

**Busy merging.** Overlapping or adjacent (within 1 second) busy intervals are merged before inversion to avoid duplicate free gaps.

## Data Types (TypeScript)

```typescript
interface Interval {
  start: Date;  // inclusive
  end:   Date;  // exclusive
}

interface Slot {
  start: Date;
  end:   Date;
}

// Pure functions — no I/O, fully testable
function applyBuffer(intervals: Interval[], bufferMs: number): Interval[]
function mergeIntervals(intervals: Interval[]): Interval[]
function invertIntervals(busy: Interval[], windowStart: Date, windowEnd: Date): Interval[]
function generateSlots(free: Interval[], durationMs: number): Slot[]
function workingDayWindow(date: Date, tz: string): Interval | null
  // returns null for Saturday/Sunday
```

## Test Cases (availability.test.ts)

| Scenario | Expected |
|---|---|
| Empty calendar, full Monday | slots from 09:00 every 30 min until 16:30 (last slot end = 17:00) |
| Full calendar (all day busy) | no slots |
| Meeting 09:00–09:30 on Monday | first slot at 09:35 (buffer), then 10:05, … |
| Meeting spanning entire morning | afternoon slots only |
| Two adjacent meetings with <5 min gap | treated as one block after buffer merge |
| Friday (short day) | last 30-min slot starts at 12:30 |
| Saturday / Sunday | no slots (returns null window) |
| `from` = today, current time = 10:00 | no slots before 10:00 |
| Duration 60 min on short Wednesday (9–13) | last slot starts 12:00 |
| Slot exactly at boundary (slot end = window end) | included |
| Slot 1 minute past boundary | excluded |
