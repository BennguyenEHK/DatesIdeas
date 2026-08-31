import { describe, it, expect } from "vitest";
import { MemeCounter, formatDuration } from "./aggregate";

describe("MemeCounter", () => {
  it("starts empty", () => {
    const c = new MemeCounter();
    expect(c.snapshot()).toEqual({});
    expect(c.total).toBe(0);
  });

  it("accumulates per meme id", () => {
    const c = new MemeCounter();
    c.record("heart");
    c.record("heart");
    c.record("peace");
    expect(c.snapshot()).toEqual({ heart: 2, peace: 1 });
    expect(c.total).toBe(3);
  });

  it("returns a copy so callers cannot mutate internal state", () => {
    const c = new MemeCounter();
    c.record("smile");
    const snap = c.snapshot();
    snap.smile = 999;
    expect(c.snapshot()).toEqual({ smile: 1 });
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [45_000, "0m"],
    [60_000, "1m"],
    [3_600_000, "1h 0m"],
    [5_400_000, "1h 30m"],
    [7_320_000, "2h 2m"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
