import { describe, expect, it } from "vitest";
import { FAN_MAX, FAN_SPREAD_DEG, fanLayout, stackEdges } from "./fan";

describe("fanLayout", () => {
  it("is empty for no memories and a single straight card for one", () => {
    expect(fanLayout(0)).toEqual([]);
    expect(fanLayout(1)).toEqual([{ kind: "print", index: 0, rotateDeg: 0, x: 0, y: 0 }]);
  });

  it("spreads cards symmetrically, the middle one straight and highest", () => {
    const cards = fanLayout(5);
    expect(cards.map((c) => c.rotateDeg)).toEqual([-28, -14, 0, 14, 28]);
    expect(cards[0].x).toBe(-cards[4].x);
    expect(cards[0].y).toBe(cards[4].y);
    expect(cards[2]).toMatchObject({ x: 0, y: 0 });
    expect(cards[0].y).toBeGreaterThan(cards[1].y);
  });

  it("never spreads wider than the fan allows", () => {
    for (const count of [2, 3, 7, 40]) {
      const angles = fanLayout(count).map((c) => c.rotateDeg);
      expect(Math.max(...angles) - Math.min(...angles)).toBeLessThanOrEqual(FAN_SPREAD_DEG);
    }
  });

  it("shows every print when they fit", () => {
    const cards = fanLayout(FAN_MAX);
    expect(cards.every((c) => c.kind === "print")).toBe(true);
    expect(cards.map((c) => (c.kind === "print" ? c.index : -1))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("ends on a card counting the rest when they do not", () => {
    const cards = fanLayout(18);
    expect(cards).toHaveLength(FAN_MAX);
    expect(cards.slice(0, -1).every((c) => c.kind === "print")).toBe(true);
    expect(cards.at(-1)).toMatchObject({ kind: "more", hidden: 18 - (FAN_MAX - 1) });
  });

  it("treats a broken count as nothing", () => {
    expect(fanLayout(Number.NaN)).toEqual([]);
    expect(fanLayout(-3)).toEqual([]);
  });
});

describe("stackEdges", () => {
  it("peeks one edge for two memories and two for more", () => {
    expect(stackEdges(1)).toBe(0);
    expect(stackEdges(2)).toBe(1);
    expect(stackEdges(9)).toBe(2);
    expect(stackEdges(Number.NaN)).toBe(0);
  });
});
