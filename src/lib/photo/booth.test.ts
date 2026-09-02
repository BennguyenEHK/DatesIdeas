import { describe, expect, it } from "vitest";
import {
  BETWEEN_MS,
  boothDurationMs,
  boothTimeline,
  LEAD_MS,
  REVIEW_MS,
  REVEAL_MS,
} from "./booth";

describe("photo booth timeline", () => {
  it("keeps four flashes nine seconds apart", () => {
    const flashes = boothTimeline(10_000, 4).filter((step) => step.kind === "flash");

    expect(BETWEEN_MS).toBe(9000);
    expect(flashes.slice(1).map((flash, index) => flash.at - flashes[index].at)).toEqual([
      9000,
      9000,
      9000,
    ]);
  });

  it.each([2, 4] as const)("schedules %i flashes in panel order", (shots) => {
    const timeline = boothTimeline(10_000, shots);
    const flashes = timeline.filter((step) => step.kind === "flash");

    expect(flashes).toHaveLength(shots);
    expect(new Set(flashes.map((step) => step.at)).size).toBe(shots);
    expect(flashes.map((step) => step.shotIndex)).toEqual([0, ...Array.from({ length: shots - 1 }, (_, i) => i + 1)]);
    expect(flashes[0].at).toBe(10_000 + LEAD_MS);
    for (let index = 1; index < flashes.length; index += 1) {
      expect(flashes[index].at - flashes[index - 1].at).toBe(REVIEW_MS + LEAD_MS);
    }
  });

  it.each([2, 4] as const)("places counts before each shot's flash", (shots) => {
    const timeline = boothTimeline(10_000, shots);
    const flashes = timeline.filter((step) => step.kind === "flash");
    const counts = timeline.filter((step) => step.kind === "count");

    for (const flash of flashes) {
      const shotCounts = counts.filter((step) => step.shotIndex === flash.shotIndex);
      expect(shotCounts.map((step) => step.value)).toEqual([7, 6, 5, 4, 3, 2, 1]);
      expect(shotCounts.map((step) => step.at)).toEqual([
        flash.at - 7000,
        flash.at - 6000,
        flash.at - 5000,
        flash.at - 4000,
        flash.at - 3000,
        flash.at - 2000,
        flash.at - 1000,
      ]);
      expect(shotCounts.at(-1)?.at).toBe(flash.at - 1000);
      expect(shotCounts.every((step) => step.at < flash.at)).toBe(true);
    }
  });

  it.each([2, 4] as const)("holds each flash for review before the next countdown", (shots) => {
    const timeline = boothTimeline(10_000, shots);
    const flashes = timeline.filter((step) => step.kind === "flash");
    const reviews = timeline.filter((step) => step.kind === "review");
    const reviewEnds = timeline.filter((step) => step.kind === "reviewEnd");
    const counts = timeline.filter((step) => step.kind === "count");

    expect(reviews.map((step) => ({ at: step.at, shotIndex: step.shotIndex }))).toEqual(
      flashes.map((step) => ({ at: step.at, shotIndex: step.shotIndex })),
    );
    expect(reviewEnds.map((step) => step.at)).toEqual(flashes.map((step) => step.at + REVIEW_MS));
    for (let shotIndex = 1; shotIndex < shots; shotIndex += 1) {
      expect(counts.find((step) => step.shotIndex === shotIndex && step.value === 7)?.at).toBe(
        reviewEnds[shotIndex - 1].at,
      );
    }
  });

  it.each([2, 4] as const)("ends with one reveal after the final flash", (shots) => {
    const timeline = boothTimeline(10_000, shots);
    const flashes = timeline.filter((step) => step.kind === "flash");
    const reveals = timeline.filter((step) => step.kind === "reveal");

    expect(reveals).toHaveLength(1);
    expect(timeline.at(-1)).toEqual(reveals[0]);
    expect(reveals[0].at).toBe(flashes.at(-1)!.at + REVIEW_MS + REVEAL_MS);
  });

  it("is sorted and uses absolute instants", () => {
    const startAt = 1_234_567;
    const timeline = boothTimeline(startAt, 4);
    const shifted = boothTimeline(startAt + 3_600_000, 4);

    expect(timeline.map((step) => step.at)).toEqual([...timeline].sort((a, b) => a.at - b.at).map((step) => step.at));
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
