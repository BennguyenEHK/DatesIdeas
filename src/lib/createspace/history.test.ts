import { describe, expect, it } from "vitest";
import { EMPTY_REDO, itemToOp, popRedo, pushRedo } from "./history";
import type { SceneItem } from "./ops";

const dot: SceneItem = {
  type: "stroke",
  id: "dot",
  author: "me",
  at: 1,
  ink: "#ffffff",
  width: 0.01,
  points: [[0, 0]],
};

describe("redo history", () => {
  it("turns a removed item back into its creation operation", () => {
    expect(itemToOp(dot)).toEqual({
      kind: "stroke",
      stroke: { id: "dot", author: "me", at: 1, ink: "#ffffff", width: 0.01, points: [[0, 0]] },
    });
  });

  it("pops the most recently undone item first", () => {
    const stack = pushRedo(pushRedo(EMPTY_REDO, dot), { ...dot, id: "later" });
    expect(popRedo(stack)).toEqual({ stack: [dot], item: { ...dot, id: "later" } });
  });
});
