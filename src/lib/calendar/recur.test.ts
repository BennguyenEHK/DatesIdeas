import { describe, it, expect } from "vitest";
import { expand, isRepeat, occurrencesIn, type BlockSeed } from "./recur";

function block(overrides: Partial<BlockSeed> = {}): BlockSeed {
  return {
    id: "b1",
    title: "Call",
    startsAt: "2026-03-03T09:00:00.000Z",
    endsAt: "2026-03-03T10:00:00.000Z",
    zone: "UTC",
    repeat: "none",
    repeatUntil: null,
    ...overrides,
  };
}

const window = (from: string, to: string) => [new Date(from), new Date(to)] as const;

describe("a block that does not repeat", () => {
  it("appears once, on the day it happens", () => {
    const [from, to] = window("2026-03-01T00:00:00Z", "2026-03-08T00:00:00Z");
    const found = occurrencesIn(block(), from, to, "UTC");
    expect(found).toHaveLength(1);
    expect(found[0].date).toBe("2026-03-03");
    expect(found[0].repeated).toBe(false);
  });

  it("does not appear in a week it does not touch", () => {
    const [from, to] = window("2026-04-01T00:00:00Z", "2026-04-08T00:00:00Z");
    expect(occurrencesIn(block(), from, to, "UTC")).toHaveLength(0);
  });

  it("appears in a window it merely overlaps", () => {
    // Started last night, still running. A calendar that only showed blocks
    // fully inside the window would lose every evening that ran past midnight.
    const [from, to] = window("2026-03-03T09:30:00Z", "2026-03-04T00:00:00Z");
    expect(occurrencesIn(block(), from, to, "UTC")).toHaveLength(1);
  });
});

describe("repeats", () => {
  it("produces one occurrence a day", () => {
    const [from, to] = window("2026-03-03T00:00:00Z", "2026-03-10T00:00:00Z");
    const found = occurrencesIn(block({ repeat: "daily" }), from, to, "UTC");
    expect(found.map((o) => o.date)).toEqual([
      "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
      "2026-03-07", "2026-03-08", "2026-03-09",
    ]);
    expect(found[0].repeated).toBe(false);
    expect(found[1].repeated).toBe(true);
  });

  it("counts a fortnight as two weeks, not two of anything else", () => {
    const [from, to] = window("2026-03-01T00:00:00Z", "2026-04-15T00:00:00Z");
    const found = occurrencesIn(block({ repeat: "fortnightly" }), from, to, "UTC");
    expect(found.map((o) => o.date)).toEqual([
      "2026-03-03", "2026-03-17", "2026-03-31", "2026-04-14",
    ]);
  });

  it("stops on the day it was told to, inclusive", () => {
    // "Until the 6th" has to include the 6th, or every person who sets an end
    // date is quietly one short.
    const [from, to] = window("2026-03-01T00:00:00Z", "2026-03-20T00:00:00Z");
    const found = occurrencesIn(
      block({ repeat: "daily", repeatUntil: "2026-03-06" }),
      from,
      to,
      "UTC",
    );
    expect(found.map((o) => o.date)).toEqual([
      "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
    ]);
  });
});

describe("a monthly repeat that started on a day not every month has", () => {
  it("clamps into February and then goes back to the 31st", () => {
    // The classic way a monthly recurrence rots is to advance from the clamped
    // value, which drags the whole series earlier for good after one short
    // month. The 31st must come back.
    const [from, to] = window("2026-01-01T00:00:00Z", "2026-05-01T00:00:00Z");
    const found = occurrencesIn(
      block({ startsAt: "2026-01-31T09:00:00.000Z", endsAt: "2026-01-31T10:00:00.000Z", repeat: "monthly" }),
      from,
      to,
      "UTC",
    );
    expect(found.map((o) => o.date)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
    ]);
  });
});

describe("daylight saving", () => {
  it("keeps a weekly block at the same wall-clock time across the change", () => {
    // Europe/London goes forward on 29 March 2026. A block at 09:00 local must
    // still be 09:00 local afterwards -- which means its UTC instant changes.
    // Expanding in UTC instead would silently move it to 08:00 for good.
    const [from, to] = window("2026-03-20T00:00:00Z", "2026-04-10T00:00:00Z");
    const found = occurrencesIn(
      block({
        startsAt: "2026-03-25T09:00:00.000Z", // 09:00 London, still GMT
        endsAt: "2026-03-25T10:00:00.000Z",
        zone: "Europe/London",
        repeat: "weekly",
      }),
      from,
      to,
      "Europe/London",
    );

    const localHour = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso));

    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const occurrence of found) {
      expect(localHour(occurrence.startsAt)).toBe("09");
    }
    // And the instant really did move, which is the whole point.
    expect(found[0].startsAt).not.toBe(found[found.length - 1].startsAt);
  });
});

describe("the viewer's own day", () => {
  it("reports the civil date in the reader's zone, not the block's", () => {
    // 23:00 in London on the 3rd is already the 4th in Hanoi. Both people are
    // looking at the same instant and should each see their own day.
    const seed = block({
      startsAt: "2026-03-03T23:00:00.000Z",
      endsAt: "2026-03-03T23:30:00.000Z",
      zone: "Europe/London",
    });
    const [from, to] = window("2026-03-01T00:00:00Z", "2026-03-10T00:00:00Z");
    expect(occurrencesIn(seed, from, to, "Europe/London")[0].date).toBe("2026-03-03");
    expect(occurrencesIn(seed, from, to, "Asia/Ho_Chi_Minh")[0].date).toBe("2026-03-04");
  });
});

describe("safety", () => {
  it("returns nothing for an unparseable instant rather than looping", () => {
    const [from, to] = window("2026-03-01T00:00:00Z", "2026-03-10T00:00:00Z");
    expect(occurrencesIn(block({ startsAt: "not a date" }), from, to, "UTC")).toEqual([]);
  });

  it("cannot run away on a forever-repeat over a wide window", () => {
    const [from, to] = window("2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z");
    const found = occurrencesIn(block({ repeat: "daily" }), from, to, "UTC");
    expect(found.length).toBeLessThanOrEqual(400);
  });
});

describe("expand", () => {
  it("merges many blocks in the order they start", () => {
    const [from, to] = window("2026-03-01T00:00:00Z", "2026-03-10T00:00:00Z");
    const found = expand(
      [
        block({ id: "late", startsAt: "2026-03-05T18:00:00.000Z", endsAt: "2026-03-05T19:00:00.000Z" }),
        block({ id: "early", startsAt: "2026-03-04T08:00:00.000Z", endsAt: "2026-03-04T09:00:00.000Z" }),
      ],
      from,
      to,
      "UTC",
    );
    expect(found.map((o) => o.blockId)).toEqual(["early", "late"]);
  });
});

describe("isRepeat", () => {
  it("accepts only the repeats the database will", () => {
    for (const value of ["none", "daily", "weekly", "fortnightly", "monthly"]) {
      expect(isRepeat(value)).toBe(true);
    }
    for (const value of ["yearly", "", null, 7, "DAILY"]) {
      expect(isRepeat(value)).toBe(false);
    }
  });
});
