import { describe, expect, it } from "vitest";
import {
  PANEL_ASPECT,
  SHOT_COUNTS,
  STRIP_WIDTH,
  type Rect,
  stripLayout,
} from "./strip";

function expectInside(rect: Rect, layout: { width: number; height: number }): void {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(layout.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(layout.height);
}

describe("photo strip layout", () => {
  it.each(SHOT_COUNTS)("orders %i panels without overlap", (shots) => {
    const layout = stripLayout(shots);

    expect(layout.panels).toHaveLength(shots);
    for (const [index, panel] of layout.panels.entries()) {
      expectInside(panel, layout);
      expect(panel.width / panel.height).toBeCloseTo(PANEL_ASPECT, 12);
      if (index > 0) {
        expect(panel.y).toBeGreaterThan(layout.panels[index - 1].y + layout.panels[index - 1].height);
      }
    }
  });

  it.each(SHOT_COUNTS)("keeps every panel and caption within a %i-shot strip", (shots) => {
    const layout = stripLayout(shots);

    for (const panel of layout.panels) {
      expectInside(panel.left, layout);
      expectInside(panel.right, layout);
      expect(panel.left.x).toBe(panel.x);
      expect(panel.left.y).toBe(panel.y);
      expect(panel.right.y).toBe(panel.y);
      expect(panel.left.height).toBe(panel.height);
      expect(panel.right.height).toBe(panel.height);
      expect(panel.left.x + panel.left.width).toBe(panel.right.x);
      expect(panel.right.x + panel.right.width).toBeCloseTo(panel.x + panel.width, 12);
      expect(panel.left.width + (panel.right.x - (panel.left.x + panel.left.width)) + panel.right.width).toBeCloseTo(panel.width, 12);
    }
    expectInside(layout.caption, layout);
  });

  it("accounts for its full height with panels, their gaps, caption, and margins", () => {
    const layout = stripLayout(4);
    const first = layout.panels[0];
    const last = layout.panels[layout.panels.length - 1];
    const margin = first.x;
    const panelGap = layout.panels[1].y - (first.y + first.height);

    expect(first.y).toBe(margin);
    expect(layout.caption.y).toBe(last.y + last.height);
    expect(layout.height).toBeCloseTo(
      margin * 2 + layout.panels.length * first.height + (layout.panels.length - 1) * panelGap + layout.caption.height,
      12,
    );
  });

  it("makes four photographs taller than two at the same width", () => {
    const two = stripLayout(2);
    const four = stripLayout(4);

    expect(two.width).toBe(STRIP_WIDTH);
    expect(four.width).toBe(STRIP_WIDTH);
    expect(four.height).toBeGreaterThan(two.height);
  });

  it("scales every dimension with the requested width", () => {
    const original = stripLayout(2, STRIP_WIDTH);
    const doubled = stripLayout(2, STRIP_WIDTH * 2);

    expect(doubled).toEqual(expect.objectContaining({ width: original.width * 2, height: original.height * 2 }));
    for (const [index, panel] of original.panels.entries()) {
      const scaled = doubled.panels[index];
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(scaled[key]).toBe(panel[key] * 2);
        expect(scaled.left[key]).toBe(panel.left[key] * 2);
        expect(scaled.right[key]).toBe(panel.right[key] * 2);
      }
    }
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(doubled.caption[key]).toBe(original.caption[key] * 2);
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s as a width",
    (width) => {
      expect(() => stripLayout(2, width)).toThrow(TypeError);
    },
  );

  it.each([0, 1, 3, 5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s as a shot count",
    (shots) => {
      expect(() => stripLayout(shots as 2 | 4)).toThrow(TypeError);
    },
  );
});
