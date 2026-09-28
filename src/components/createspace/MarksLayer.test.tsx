import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasOp, Scene } from "@/lib/createspace/ops";
import { MarksLayer, type MarksLayerProps } from "./MarksLayer";

const rect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 200,
  bottom: 100,
  width: 200,
  height: 100,
  toJSON: () => ({}),
} as DOMRect;

function input(patch: Partial<MarksLayerProps> = {}): MarksLayerProps {
  return {
    ariaLabel: "marks",
    scene: { items: [] },
    identity: "me",
    sharedNow: () => 44,
    tool: "pencil",
    ink: "#ffffff",
    width: 0.01,
    glyph: null,
    stickerScale: 1,
    selectedStickerId: null,
    onSelectedSticker: vi.fn(),
    onOp: vi.fn(),
    ...patch,
  };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => vi.restoreAllMocks());

function placedAt(mirrored: boolean): { x: number; y: number } {
  const onOp = vi.fn<(op: CanvasOp) => void>();
  render(<MarksLayer {...input({ glyph: "👑", onOp, mirrored })} />);
  fireEvent.pointerDown(screen.getByLabelText("marks"), { clientX: 40, clientY: 30, pointerId: 1 });
  const op = onOp.mock.calls[0][0];
  if (op.kind !== "sticker") throw new Error("expected a sticker");
  return { x: op.sticker.x, y: op.sticker.y };
}

describe("MarksLayer on the screen that sees the strip flipped", () => {
  // Each screen puts its own person on the left, so a crown dropped on the
  // left of this screen is on the RIGHT of the other one's strip -- the same
  // face. Kept unflipped, it landed on the other person.
  it("sends a sticker placed on the left as the right of the shared frame", () => {
    expect(placedAt(true)).toEqual({ x: 0.8, y: 0.3 });
  });

  it("leaves the unflipped screen's placement exactly where it was put", () => {
    expect(placedAt(false)).toEqual({ x: 0.2, y: 0.3 });
  });

  it("picks up its own sticker where it is drawn, not where it is stored", () => {
    const scene: Scene = {
      items: [
        { type: "sticker", id: "s1", author: "me", at: 1, glyph: "👑", x: 0.8, y: 0.3, scale: 1, rotation: 0 },
      ],
    };
    const onSelectedSticker = vi.fn();
    render(<MarksLayer {...input({ scene, onSelectedSticker, mirrored: true })} />);
    fireEvent.pointerDown(screen.getByLabelText("marks"), { clientX: 40, clientY: 30, pointerId: 1 });
    expect(onSelectedSticker).toHaveBeenCalledWith("s1");
  });

  it("sends strokes in the shared frame too", () => {
    const onOp = vi.fn<(op: CanvasOp) => void>();
    render(<MarksLayer {...input({ onOp, mirrored: true })} />);
    const canvas = screen.getByLabelText("marks");
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 20, pointerId: 1 });
    const op = onOp.mock.calls[0][0];
    if (op.kind !== "stroke") throw new Error("expected a stroke");
    expect(op.stroke.points[0][0]).toBeCloseTo(0.9);
    expect(op.stroke.points[op.stroke.points.length - 1][0]).toBeCloseTo(0.7);
  });
});
