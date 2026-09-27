import { describe, expect, it } from "vitest";
import { applyPlace, boardFrom, boardLayout, newer, nextZ } from "./layout";

const stamp = { at: 1, by: "a" };
const place = { pieceId: "piece01", x: 0.5, y: 0.5, scale: 1, z: 2 };

describe("lookbook board layout", () => {
  it("orders stamps by time, then identity", () => {
    expect(newer({ at: 2, by: "a" }, stamp)).toBe(true);
    expect(newer({ at: 1, by: "b" }, stamp)).toBe(true);
    expect(newer(stamp, stamp)).toBe(false);
  });
  it("keeps the newer placement and ignores its duplicate", () => {
    const board = boardFrom([place], stamp);
    const moved = applyPlace(board, {
      pieceId: place.pieceId,
      place: { ...place, x: 0.8 },
      stamp: { at: 2, by: "a" },
    });
    expect(boardLayout(moved)[0].x).toBe(0.8);
    expect(applyPlace(moved, { pieceId: place.pieceId, place: { ...place, x: 0.1 }, stamp })).toBe(
      moved,
    );
    expect(
      applyPlace(moved, {
        pieceId: place.pieceId,
        place: { ...place, x: 0.8 },
        stamp: { at: 2, by: "a" },
      }),
    ).toBe(moved);
  });
  it("uses removal tombstones and lets a later placement restore a piece", () => {
    const board = boardFrom([place], stamp);
    const removed = applyPlace(board, {
      pieceId: place.pieceId,
      place: null,
      stamp: { at: 2, by: "a" },
    });
    expect(boardLayout(removed)).toEqual([]);
    expect(applyPlace(removed, { pieceId: place.pieceId, place: { ...place }, stamp })).toBe(
      removed,
    );
    expect(
      boardLayout(
        applyPlace(removed, {
          pieceId: place.pieceId,
          place: { ...place },
          stamp: { at: 3, by: "a" },
        }),
      ),
    ).toEqual([place]);
  });
  it("caps a board at twenty pieces and returns stable sorted layouts", () => {
    const layout = Array.from({ length: 20 }, (_, index) => ({
      ...place,
      pieceId: `piece${String(index).padStart(2, "0")}`,
      z: 20 - index,
    }));
    const board = boardFrom(layout, stamp);
    expect(
      applyPlace(board, {
        pieceId: "piece20",
        place: { x: 0, y: 0, scale: 1, z: 21 },
        stamp: { at: 2, by: "a" },
      }),
    ).toBe(board);
    expect(boardLayout(board).map((item) => item.pieceId)).toEqual(
      [...layout]
        .sort((a, b) => a.z - b.z || a.pieceId.localeCompare(b.pieceId))
        .map((item) => item.pieceId),
    );
    expect(nextZ(board)).toBe(21);
    expect(nextZ(boardFrom([], stamp))).toBe(0);
  });
});
