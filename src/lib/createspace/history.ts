import type { CanvasOp, SceneItem } from "./ops";

/** Turns an existing scene item back into the operation that created it. */
export function itemToOp(item: SceneItem): CanvasOp {
  if (item.type === "stroke") {
    const { type, ...stroke } = item;
    void type;
    return { kind: "stroke", stroke };
  }
  const { type, ...sticker } = item;
  void type;
  return { kind: "sticker", sticker };
}

export type RedoStack = readonly SceneItem[];
export const EMPTY_REDO: RedoStack = [];

/** The top is the last item undone, which is therefore the first redone. */
export function pushRedo(stack: RedoStack, item: SceneItem): RedoStack {
  return [...stack, item];
}

export function popRedo(stack: RedoStack): { stack: RedoStack; item: SceneItem | null } {
  const item = stack.at(-1) ?? null;
  return { stack: item === null ? stack : stack.slice(0, -1), item };
}
