import { describe, expect, it } from "vitest";
import {
  LAYOUT_MAX,
  isLayout,
  isLookbookPiece,
  isOutfit,
  isPlacement,
  isWearOn,
  type Outfit,
  type Placement,
} from "./types";

const place = (over: Partial<Placement> = {}): Placement => ({
  pieceId: "piece_001",
  x: 0.5,
  y: 0.5,
  scale: 1,
  z: 0,
  ...over,
});

const outfit = (over: Partial<Outfit> = {}): Outfit => ({
  id: "outfit_01",
  name: "Saturday",
  wearOn: "2026-10-03",
  note: "",
  createdBy: "k-identity",
  lovedBy: ["ben-identity"],
  layout: [place()],
  createdAt: "2026-09-27T10:00:00Z",
  updatedAt: "2026-09-27T10:00:00Z",
  ...over,
});

describe("lookbook shapes", () => {
  it("accepts a real day and refuses one that does not exist", () => {
    expect(isWearOn("2026-10-03")).toBe(true);
    expect(isWearOn("2026-02-30")).toBe(false);
    expect(isWearOn("3 October")).toBe(false);
  });

  it("keeps a placement on the board and within its size range", () => {
    expect(isPlacement(place())).toBe(true);
    expect(isPlacement(place({ x: 1.2 }))).toBe(false);
    expect(isPlacement(place({ scale: 5 }))).toBe(false);
    expect(isPlacement(place({ z: -1 }))).toBe(false);
    expect(isPlacement(place({ pieceId: "../x" }))).toBe(false);
  });

  it("allows each piece on a board once, and no more than the cap", () => {
    expect(isLayout([place(), place({ pieceId: "piece_002" })])).toBe(true);
    expect(isLayout([place(), place()])).toBe(false);
    const full = Array.from({ length: LAYOUT_MAX + 1 }, (_, i) =>
      place({ pieceId: `piece_${String(i).padStart(3, "0")}` }),
    );
    expect(isLayout(full)).toBe(false);
  });

  it("checks a whole outfit and a whole piece", () => {
    expect(isOutfit(outfit())).toBe(true);
    expect(isOutfit(outfit({ wearOn: null }))).toBe(true);
    expect(isOutfit(outfit({ name: "   " }))).toBe(false);
    expect(
      isLookbookPiece({
        id: "piece_001",
        kind: "dress",
        label: "black silk slip",
        addedBy: "k-identity",
        url: "https://example.test/p.jpg",
        createdAt: "2026-09-27T10:00:00Z",
      }),
    ).toBe(true);
    expect(isLookbookPiece({ id: "piece_001", kind: "hat" })).toBe(false);
  });
});
