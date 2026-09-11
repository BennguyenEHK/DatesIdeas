import { describe, it, expect } from "vitest";
import {
  RECORDING_HEIGHT,
  RECORDING_WIDTH,
  coverCrop,
  formatElapsed,
  pairLayout,
} from "./layout";

describe("pairLayout", () => {
  it("gives one feed the whole frame", () => {
    const [only] = pairLayout(1280, 720, 1);
    expect(only).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("splits two feeds evenly, neither of them the main one", () => {
    // Side by side rather than picture-in-picture on purpose: what you want to
    // watch back is the two of you reacting to each other, and an inset corner
    // throws one of those away.
    const [left, right] = pairLayout(1280, 720, 2);
    expect(left.width).toBe(right.width);
    expect(left.height).toBe(right.height);
    expect(left.y).toBe(right.y);
    expect(right.x).toBeGreaterThan(left.x + left.width);
  });

  it("keeps both tiles inside the frame", () => {
    const [left, right] = pairLayout(RECORDING_WIDTH, RECORDING_HEIGHT, 2);
    for (const tile of [left, right]) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(RECORDING_WIDTH);
      expect(tile.y + tile.height).toBeLessThanOrEqual(RECORDING_HEIGHT);
    }
  });
});

describe("coverCrop", () => {
  it("takes a full-height slice from a source that is too wide", () => {
    const crop = coverCrop(1920, 1080, 100, 100);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(1080);
    // Centred, so a face in the middle of the frame stays in the middle.
    expect(crop.x).toBeCloseTo((1920 - 1080) / 2);
    expect(crop.y).toBe(0);
  });

  it("takes a full-width slice from a source that is too tall", () => {
    // A phone held upright, which is most of them.
    const crop = coverCrop(720, 1280, 160, 90);
    expect(crop.width).toBe(720);
    expect(crop.height).toBeCloseTo(720 / (160 / 90));
    expect(crop.x).toBe(0);
    expect(crop.y).toBeGreaterThan(0);
  });

  it("leaves a source already the right shape alone", () => {
    expect(coverCrop(1280, 720, 640, 360)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("never returns a negative rectangle for a source with no dimensions", () => {
    // A video element with nothing decoded yet reports 0x0, and this runs on
    // every painted frame.
    const crop = coverCrop(0, 0, 100, 100);
    expect(crop.width).toBeGreaterThanOrEqual(0);
    expect(crop.height).toBeGreaterThanOrEqual(0);
  });
});

describe("formatElapsed", () => {
  it("counts in minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(61_000)).toBe("1:01");
    expect(formatElapsed(600_000)).toBe("10:00");
  });

  it("earns an hours column only once there is an hour", () => {
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59:59");
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
  });

  it("does not go backwards past zero", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});
