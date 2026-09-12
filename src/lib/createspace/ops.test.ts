import { describe, it, expect } from "vitest";
import {
  EMPTY_SCENE,
  MAX_POINTS,
  applyOp,
  isCanvasOp,
  replay,
  thin,
  undoTarget,
  type CanvasOp,
  type Sticker,
  type Stroke,
} from "./ops";

function stroke(id: string, author: string, at: number): Stroke {
  return { id, author, at, ink: "#e8b94a", width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] };
}

function sticker(id: string, author: string, at: number, x = 0.5): Sticker {
  return { id, author, at, glyph: "❤️", x, y: 0.5, scale: 1, rotation: 0 };
}

const ids = (ops: CanvasOp[]) => replay(ops).items.map((item) => item.id);

describe("two screens agree", () => {
  it("reach the same picture whichever order the edits arrive in", () => {
    // The whole point of the module. Each side paints its own stroke first and
    // hears about the other's second, so the two receive these in opposite
    // orders -- and must still stack them identically.
    const mine: CanvasOp = { kind: "stroke", stroke: stroke("a", "ben", 100) };
    const theirs: CanvasOp = { kind: "stroke", stroke: stroke("b", "k", 105) };
    expect(ids([mine, theirs])).toEqual(ids([theirs, mine]));
    expect(ids([mine, theirs])).toEqual(["a", "b"]);
  });

  it("break a tie on the clock by id, so an exact collision still agrees", () => {
    const left: CanvasOp = { kind: "stroke", stroke: stroke("x", "ben", 100) };
    const right: CanvasOp = { kind: "stroke", stroke: stroke("m", "k", 100) };
    expect(ids([left, right])).toEqual(ids([right, left]));
    expect(ids([left, right])).toEqual(["m", "x"]);
  });

  it("ignore an edit delivered twice", () => {
    const op: CanvasOp = { kind: "stroke", stroke: stroke("a", "ben", 1) };
    expect(replay([op, op]).items).toHaveLength(1);
  });

  it("agree after a removal, whenever it lands", () => {
    const add: CanvasOp = { kind: "stroke", stroke: stroke("a", "ben", 1) };
    const keep: CanvasOp = { kind: "stroke", stroke: stroke("b", "k", 2) };
    const remove: CanvasOp = { kind: "remove", id: "a" };
    expect(ids([add, keep, remove])).toEqual(["b"]);
    expect(ids([keep, add, remove])).toEqual(["b"]);
  });
});

describe("stickers", () => {
  it("moves a sticker in place rather than adding a second one", () => {
    const scene = replay([
      { kind: "sticker", sticker: sticker("s", "ben", 1, 0.2) },
      { kind: "sticker", sticker: sticker("s", "ben", 50, 0.8) },
    ]);
    expect(scene.items).toHaveLength(1);
    expect(scene.items[0].type === "sticker" && scene.items[0].x).toBe(0.8);
  });

  it("keeps a moved sticker's place in the stack", () => {
    // Taking the move's timestamp would lift the sticker above everything drawn
    // since, every time it was nudged.
    const scene = replay([
      { kind: "sticker", sticker: sticker("s", "ben", 1) },
      { kind: "stroke", stroke: stroke("later", "k", 10) },
      { kind: "sticker", sticker: sticker("s", "ben", 99, 0.9) },
    ]);
    expect(scene.items.map((item) => item.id)).toEqual(["s", "later"]);
  });
});

describe("undo", () => {
  it("takes back your own last item, never the other person's", () => {
    // Undo reaching across to erase somebody else's stroke is the fastest way
    // to make drawing together feel like a fight.
    const scene = replay([
      { kind: "stroke", stroke: stroke("mine-1", "ben", 1) },
      { kind: "stroke", stroke: stroke("theirs", "k", 5) },
    ]);
    expect(undoTarget(scene, "ben")).toBe("mine-1");
    expect(undoTarget(scene, "k")).toBe("theirs");
    expect(undoTarget(scene, "nobody")).toBeNull();
  });
});

describe("clear", () => {
  it("empties the picture", () => {
    expect(applyOp(replay([{ kind: "stroke", stroke: stroke("a", "ben", 1) }]), { kind: "clear" })).toEqual(
      EMPTY_SCENE,
    );
  });
});

describe("thin", () => {
  it("drops points closer together than a hand can mean", () => {
    const dense: [number, number][] = Array.from({ length: 100 }, (_, i) => [0.5 + i * 0.00001, 0.5]);
    expect(thin(dense).length).toBeLessThan(5);
  });

  it("keeps the start of a stroke even when it is a single point", () => {
    expect(thin([[0.3, 0.3]])).toEqual([[0.3, 0.3]]);
  });
});

describe("isCanvasOp, on what the other browser sent", () => {
  it("accepts every well-formed operation", () => {
    expect(isCanvasOp({ kind: "stroke", stroke: stroke("a", "ben", 1) })).toBe(true);
    expect(isCanvasOp({ kind: "sticker", sticker: sticker("s", "ben", 1) })).toBe(true);
    expect(isCanvasOp({ kind: "remove", id: "a" })).toBe(true);
    expect(isCanvasOp({ kind: "clear" })).toBe(true);
  });

  it("refuses an ink outside the palette", () => {
    expect(isCanvasOp({ kind: "stroke", stroke: { ...stroke("a", "ben", 1), ink: "#ff0000" } })).toBe(false);
  });

  it("refuses a stroke too long to be one", () => {
    // A stroke is one message on a channel that also carries the call. An
    // unbounded one is a way for a single frame to hang the canvas.
    const points = Array.from({ length: MAX_POINTS + 1 }, () => [0.5, 0.5]);
    expect(isCanvasOp({ kind: "stroke", stroke: { ...stroke("a", "ben", 1), points } })).toBe(false);
  });

  it("refuses points far outside the picture and non-numbers", () => {
    expect(isCanvasOp({ kind: "stroke", stroke: { ...stroke("a", "ben", 1), points: [[5, 5]] } })).toBe(false);
    expect(isCanvasOp({ kind: "stroke", stroke: { ...stroke("a", "ben", 1), points: [["x", 1]] } })).toBe(false);
  });

  it("refuses a sticker that is not one of ours, or scaled absurdly", () => {
    expect(isCanvasOp({ kind: "sticker", sticker: { ...sticker("s", "ben", 1), glyph: "💩" } })).toBe(false);
    expect(isCanvasOp({ kind: "sticker", sticker: { ...sticker("s", "ben", 1), scale: 400 } })).toBe(false);
  });

  it("refuses anything that is not an operation at all", () => {
    for (const value of [null, 1, "clear", {}, { kind: "explode" }, { kind: "remove" }]) {
      expect(isCanvasOp(value)).toBe(false);
    }
  });
});
