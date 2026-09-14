import { describe, expect, it } from "vitest";
import { placeBackdrop, stripAspect } from "./compose";

describe("placeBackdrop", () => {
  it("covers the panel and centres the selected fractional point", () => {
    expect(
      placeBackdrop({ x: 10, y: 20, width: 200, height: 100 }, 100, 100, { x: 0.5, y: 0.5, scale: 1 }),
    ).toEqual({ x: 10, y: -30, width: 200, height: 200 });
  });

  it("reports the workshop strip's actual aspect ratio", () => {
    expect(stripAspect(4)).toBeLessThan(stripAspect(1));
  });
});
