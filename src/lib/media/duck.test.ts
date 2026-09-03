import { describe, expect, it } from "vitest";
import {
  DUCK_DOWN_MS,
  DUCK_HOLD_MS,
  DUCK_TICK_MS,
  DUCK_UP_MS,
  DUCK_WORTH_IT_SEC,
  duckPlan,
  duckSilentAtMs,
  duckTotalMs,
  worthDucking,
} from "./duck";

describe("duck timing", () => {
  it("seeks in the middle of the silence", () => {
    expect(duckSilentAtMs()).toBe(DUCK_DOWN_MS + DUCK_HOLD_MS / 2);
  });

  it("reports the complete fade length", () => {
    expect(duckTotalMs()).toBe(DUCK_DOWN_MS + DUCK_HOLD_MS + DUCK_UP_MS);
  });

  it("starts at zero milliseconds", () => {
    expect(duckPlan(73)[0]).toEqual({ atMs: 0, volume: 73 });
  });

  it("ends at the total and restores the original volume", () => {
    const plan = duckPlan(73, 37);
    expect(plan[plan.length - 1]).toEqual({ atMs: duckTotalMs(), volume: 73 });
  });

  it("holds silence across the whole hold window", () => {
    const plan = duckPlan(80, 17);
    expect(
      plan.filter(
        (step) => step.atMs >= DUCK_DOWN_MS && step.atMs <= DUCK_DOWN_MS + DUCK_HOLD_MS,
      ).every((step) => step.volume === 0),
    ).toBe(true);
  });

  it("emits strictly increasing instants", () => {
    const plan = duckPlan(80, 20);
    for (let index = 1; index < plan.length; index += 1) {
      expect(plan[index].atMs).toBeGreaterThan(plan[index - 1].atMs);
    }
  });

  it("walks a monotone non-increasing fade out", () => {
    const down = duckPlan(91).filter((step) => step.atMs <= DUCK_DOWN_MS);
    for (let index = 1; index < down.length; index += 1) {
      expect(down[index].volume).toBeLessThanOrEqual(down[index - 1].volume);
    }
  });

  it("walks a monotone non-decreasing fade in", () => {
    const holdEnd = DUCK_DOWN_MS + DUCK_HOLD_MS;
    const up = duckPlan(91).filter((step) => step.atMs >= holdEnd);
    for (let index = 1; index < up.length; index += 1) {
      expect(up[index].volume).toBeGreaterThanOrEqual(up[index - 1].volume);
    }
  });

  it("uses integer volumes only", () => {
    expect(duckPlan(99, 13).every((step) => Number.isInteger(step.volume))).toBe(true);
  });

  it("makes a zero-volume input a real all-zero plan", () => {
    const plan = duckPlan(0);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((step) => step.volume === 0)).toBe(true);
  });

  it("clamps volume above the player range", () => {
    expect(duckPlan(101)[0].volume).toBe(100);
  });

  it("clamps negative volume to zero", () => {
    expect(duckPlan(-5).every((step) => step.volume === 0)).toBe(true);
  });

  it("treats NaN volume as zero", () => {
    expect(duckPlan(Number.NaN).every((step) => step.volume === 0)).toBe(true);
  });

  it("falls back to the default tick when tick is zero", () => {
    expect(duckPlan(50, 0)).toEqual(duckPlan(50, DUCK_TICK_MS));
  });

  it("ends exactly on the total with an uneven tick", () => {
    const plan = duckPlan(64, 37);
    expect(plan[plan.length - 1]).toEqual({ atMs: duckTotalMs(), volume: 64 });
  });
});

describe("worthDucking", () => {
  it("accepts the threshold", () => {
    expect(worthDucking(DUCK_WORTH_IT_SEC)).toBe(true);
  });

  it("rejects just-below-threshold corrections", () => {
    expect(worthDucking(DUCK_WORTH_IT_SEC - 0.001)).toBe(false);
  });

  it("accepts just-above-threshold corrections", () => {
    expect(worthDucking(DUCK_WORTH_IT_SEC + 0.001)).toBe(true);
  });

  it("uses the magnitude for negative errors", () => {
    expect(worthDucking(-DUCK_WORTH_IT_SEC)).toBe(true);
    expect(worthDucking(-0.1)).toBe(false);
  });

  it("rejects NaN", () => {
    expect(worthDucking(Number.NaN)).toBe(false);
  });
});
