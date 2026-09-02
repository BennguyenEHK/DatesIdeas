import { describe, expect, it } from "vitest";
import {
  FACES_FR,
  SCREEN_FR,
  TILE_ASPECT,
  sideBySideAspect,
  takeoverAspect,
} from "./stage";

describe("stage aspect ratios", () => {
  it("matches the two default grid layouts exactly", () => {
    expect(TILE_ASPECT).toBe(16 / 9);
    expect(sideBySideAspect()).toBe(32 / 9);
    expect(takeoverAspect()).toBe(64 / 27);
  });

  it("scales a side-by-side row to three tiles", () => {
    expect(sideBySideAspect(3)).toBe(16 / 3);
  });

  it("follows a different takeover column split", () => {
    expect(takeoverAspect(5, 2)).toBeCloseTo(112 / 45, 12);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s as a side-by-side tile count",
    (tiles) => {
      expect(() => sideBySideAspect(tiles)).toThrow(TypeError);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s as a takeover screen fraction",
    (screenFr) => {
      expect(() => takeoverAspect(screenFr, FACES_FR)).toThrow(TypeError);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s as a takeover face fraction",
    (facesFr) => {
      expect(() => takeoverAspect(SCREEN_FR, facesFr)).toThrow(TypeError);
    },
  );
});
