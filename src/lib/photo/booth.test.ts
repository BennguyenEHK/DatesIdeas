import { describe, expect, it } from "vitest";
import {
  BETWEEN_MS,
  boothDurationMs,
  boothTimeline,
  LEAD_MS,
  REVEAL_MS,
} from "./booth";

describe("photo booth timeline", () => {
  it.each([2, 4] as const)("schedules %i flashes in panel order", (shots) => {
    const timeline = boothTimeline(10_000, shots);
    const flashes = timeline.filter((step) => step.kind === "flash");

    expect(flashes).toHaveLength(shots);
    expect(flashes.map((step) => step.shotIndex)).toEqual([0, ...Array.from({ length: shots - 1 }, (_, i) => i + 1)]);
    expect(flashes[0].at).toBe(10_000 + LEAD_MS);
    for (let index = 1; index < flashes.length; index += 1) {
      expect(flashes[index].at - flashes[index - 1].at).toBe(BETWEEN_MS);
    }
  });

  it.each([2, 4] as const)("places counts before each shot's flash", (shots) => {
    const timeline = boothTimeline(10_000, shots);
    const flashes = timeline.filter((step) => step.kind === "flash");
    const counts = timeline.filter((step) => step.kind === "count");

    expect(counts.map((step) => step.value)).toEqual([3, 2, 1, ...Array(shots - 1).fill(1)]);
    for (const flash of flashes) {
      const shotCounts = counts.filter((step) => step.shotIndex === flash.shotIndex);
      expect(shotCounts.at(-1)?.at).toBe(flash.at - 1000);
      expect(shotCounts.every((step) => step.at < flash.at)).toBe(true);
      if (flash.shotIndex > 0) {
        expect(shotCounts[0].at).toBe(flashes[flash.shotIndex - 1].at + 800);
      }
    }
  });

  it.each([2, 4] as const)("ends with one reveal after the final flash", (shots) => {
    const timeline = boothTimeline(10_000, shots);
    const flashes = timeline.filter((step) => step.kind === "flash");
    const reveals = timeline.filter((step) => step.kind === "reveal");

    expect(reveals).toHaveLength(1);
    expect(timeline.at(-1)).toEqual(reveals[0]);
    expect(reveals[0].at).toBe(flashes.at(-1)!.at + REVEAL_MS);
  });

  it("is sorted, collision-free, and uses absolute instants", () => {
    const startAt = 1_234_567;
    const timeline = boothTimeline(startAt, 4);
    const shifted = boothTimeline(startAt + 3_600_000, 4);

    expect(timeline.map((step) => step.at)).toEqual([...timeline].sort((a, b) => a.at - b.at).map((step) => step.at));
    expect(new Set(timeline.map((step) => step.at)).size).toBe(timeline.length);
    expect(shifted.map((step) => ({ ...step, at: step.at - 3_600_000 }))).toEqual(timeline);
  });

  it.each([2, 4] as const)("matches boothDurationMs for %i shots", (shots) => {
    const startAt = 500;
    const timeline = boothTimeline(startAt, shots);
    expect(boothDurationMs(shots)).toBe(timeline.at(-1)!.at - startAt);
  });

  it.each([0, 1, 3, 5, Number.NaN])("rejects invalid shot count %s", (shots) => {
    expect(() => boothTimeline(0, shots as 2 | 4)).toThrow(TypeError);
    expect(() => boothDurationMs(shots as 2 | 4)).toThrow(TypeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects invalid start %s", (startAt) => {
    expect(() => boothTimeline(startAt, 2)).toThrow(TypeError);
  });
});
