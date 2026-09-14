import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasOp } from "@/lib/createspace/ops";
import { StripCanvas, type StripCanvasProps } from "./StripCanvas";

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

function input(patch: Partial<StripCanvasProps> = {}): StripCanvasProps {
  return {
    scene: { items: [] },
    shots: 1,
    paper: "#ffffff",
    backdrop: null,
    image: null,
    merge: false,
    localStream: null,
    remoteStream: null,
    identity: "me",
    sharedNow: () => 44,
    tool: "pencil",
    ink: "#ffffff",
    width: 0.01,
    glyph: null,
    stickerScale: 1,
    selectedStickerId: null,
    backdropEditing: false,
    onSelectedSticker: vi.fn(),
    onOp: vi.fn(),
    onBackdrop: vi.fn(),
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

describe("StripCanvas", () => {
  it("lays out one photo window per requested shot", () => {
    render(<StripCanvas {...input({ shots: 3 })} />);
    expect(screen.getAllByLabelText(/Photo window \d/)).toHaveLength(3);
  });

  it("emits the chosen tool, ink and width for a pointer stroke", () => {
    const onOp = vi.fn<(op: CanvasOp) => void>();
    render(<StripCanvas {...input({ tool: "spray", ink: "#ff0099", width: 0.031, onOp })} />);
    const canvas = screen.getByLabelText("Photo strip drawing canvas");
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 50, pointerId: 1 });

    expect(onOp).toHaveBeenCalledWith({
      kind: "stroke",
      stroke: expect.objectContaining({
        tool: "spray",
        ink: "#ff0099",
        width: 0.031,
        author: "me",
      }),
    });
  });
});
