import { describe, it, expect } from "vitest";
import { DIM_DEPTH, DIM_DOWN_MS, DIM_UP_MS } from "./houseLights";

/**
 * The fade is the browser's job now, so what is left to protect here are the
 * three decisions that shape it. Each of these was a deliberate choice and each
 * would be easy to undo by accident.
 */
describe("the house lights", () => {
  it("comes back up more slowly than it goes down", () => {
    // The asymmetry duck.ts already uses: a dip that returns at the speed it
    // left reads as a glitch, and one that returns slower reads as intended.
    expect(DIM_UP_MS).toBeGreaterThan(DIM_DOWN_MS);
  });

  it("goes down promptly enough not to hold the film up", () => {
    expect(DIM_DOWN_MS).toBeLessThanOrEqual(3000);
  });

  it("stops short of total darkness", () => {
    // A room nobody can find the pause button in is not a feature.
    expect(DIM_DEPTH).toBeGreaterThan(0);
    expect(DIM_DEPTH).toBeLessThan(1);
  });
});
