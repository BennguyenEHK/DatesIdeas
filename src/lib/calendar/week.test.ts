import { describe, expect, it } from "vitest";
import type { Occurrence } from "./recur";
import { overlapColumns, placeOccurrence, weekDays, weekStart } from "./week";

const occurrence = (overrides: Partial<Occurrence> = {}): Occurrence => ({
  blockId: "one",
  startsAt: "2026-03-04T09:00:00.000Z",
  endsAt: "2026-03-04T10:00:00.000Z",
  date: "2026-03-04",
  repeated: false,
  ...overrides,
});

describe("week layout", () => {
  it("finds Monday in the viewer's zone rather than the machine's", () => {
    const start = weekStart(
      new Date("2026-03-02T01:00:00.000Z"),
      "America/Los_Angeles",
    );
    expect(start.toISOString()).toBe("2026-02-23T08:00:00.000Z");
    expect(weekDays(start, "America/Los_Angeles")[0]).toEqual({
      date: "2026-02-23",
      label: "Mon 23",
    });
  });

  it("lays the same instant at different clock positions for each zone", () => {
    const item = occurrence({
      startsAt: "2026-03-04T09:00:00.000Z",
      endsAt: "2026-03-04T10:00:00.000Z",
    });
    expect(placeOccurrence(item, "2026-03-04", "UTC")?.topPct).toBeCloseTo(37.5);
    expect(
      placeOccurrence(item, "2026-03-04", "America/Los_Angeles")?.topPct,
    ).toBeCloseTo(4.17, 1);
  });

  it("clips an overnight block into both days", () => {
    const item = occurrence({
      startsAt: "2026-03-04T23:00:00.000Z",
      endsAt: "2026-03-05T01:00:00.000Z",
    });
    expect(placeOccurrence(item, "2026-03-04", "UTC")?.topPct).toBeCloseTo(95.83, 1);
    expect(placeOccurrence(item, "2026-03-05", "UTC")).toMatchObject({ topPct: 0 });
  });

  it("keeps an instant block visible", () => {
    expect(
      placeOccurrence(
        occurrence({ endsAt: "2026-03-04T09:00:00.000Z" }),
        "2026-03-04",
        "UTC",
      )?.heightPct,
    ).toBeGreaterThan(0);
  });

  it("gives overlapping blocks separate columns but lets touching blocks share", () => {
    const first = occurrence({
      blockId: "first",
      endsAt: "2026-03-04T10:00:00.000Z",
    });
    const overlap = occurrence({
      blockId: "overlap",
      startsAt: "2026-03-04T09:30:00.000Z",
    });
    const touching = occurrence({
      blockId: "touching",
      startsAt: "2026-03-04T10:00:00.000Z",
      endsAt: "2026-03-04T11:00:00.000Z",
    });
    const columns = overlapColumns([first, overlap, touching]);
    expect(columns.get("first")).toEqual({ index: 0, of: 2 });
    expect(columns.get("overlap")).toEqual({ index: 1, of: 2 });
    expect(columns.get("touching")).toEqual({ index: 0, of: 1 });
  });
});
