import { describe, expect, it } from "vitest";
import {
  DIM_DEPTH,
  DIM_DOWN_MS,
  DIM_UP_MS,
  levelAt,
  nextState,
} from "./houseLights";

describe("house-light timing", () => {
  it("dims over three seconds and rises over five", () => {
    expect(levelAt("dimming", 0)).toBe(0);
    expect(levelAt("dimming", DIM_DOWN_MS)).toBe(1);
    expect(levelAt("rising", 0)).toBe(1);
    expect(levelAt("rising", DIM_UP_MS)).toBe(0);
  });

  it("keeps completed states at their endpoints", () => {
    expect(levelAt("up", 9001)).toBe(0);
    expect(levelAt("down", -20)).toBe(1);
    expect(levelAt("dimming", Infinity)).toBe(1);
    expect(levelAt("rising", Number.NaN)).toBe(1);
  });

  it("clamps nonsense elapsed times and starting levels", () => {
    expect(levelAt("dimming", -100, 4)).toBe(1);
    expect(levelAt("rising", 100, -2)).toBe(0);
    expect(levelAt("rising", 100, 2)).toBeCloseTo(0.98);
  });

  it("rises from the level where an interrupted dim actually stopped", () => {
    const halfwayDown = levelAt("dimming", DIM_DOWN_MS / 2);

    expect(halfwayDown).toBe(0.5);
    expect(levelAt("rising", DIM_UP_MS / 2, halfwayDown)).toBe(0.25);
    expect(levelAt("rising", 0, halfwayDown)).toBe(halfwayDown);
  });

  it("moves between the four named states without inventing a fifth state", () => {
    expect(nextState(true, "up")).toBe("dimming");
    expect(nextState(true, "dimming")).toBe("dimming");
    expect(nextState(true, "down")).toBe("down");
    expect(nextState(false, "down")).toBe("rising");
    expect(nextState(false, "rising")).toBe("rising");
    expect(nextState(false, "up")).toBe("up");
  });

  it("keeps the final room tone short of pitch black", () => {
    expect(DIM_DEPTH).toBe(0.72);
  });
});
