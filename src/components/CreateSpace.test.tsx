import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSpace } from "./CreateSpace";
import type { CanvasOp, Scene } from "@/lib/createspace/ops";
import { paintScene } from "@/lib/createspace/render";

vi.mock("@/lib/createspace/render", () => ({
  fitContain: vi.fn(() => ({ x: 0, y: 0, width: 1, height: 1 })),
  paintScene: vi.fn(),
}));

vi.mock("./PicturePicker", () => ({
  PicturePicker: ({ onPick }: { onPick: (id: string | null) => void }) => (
    <button type="button" onClick={() => onPick(null)}>
      Blank page
    </button>
  ),
}));

const emptyScene: Scene = { items: [] };

function makeProps(scene: Scene = emptyScene) {
  return {
    identity: "me",
    scene,
    baseItemId: null,
    room: "room-1",
    sharedNow: () => 500,
    onOp: vi.fn<(op: CanvasOp) => void>(),
    onBase: vi.fn<(id: string | null) => void>(),
  };
}

const rectangle = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  bottom: 100,
  right: 200,
  width: 200,
  height: 100,
  toJSON: () => ({}),
} as DOMRect;

beforeEach(() => {
  vi.mocked(paintScene).mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectangle);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CreateSpace", () => {
  it("emits a normalised stroke owned by the person drawing it", () => {
    const props = makeProps();
    render(<CreateSpace {...props} />);
    const canvas = screen.getByLabelText("Shared drawing canvas");

    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 25, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 75, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 75, pointerId: 1 });

    expect(props.onOp).toHaveBeenCalledTimes(1);
    expect(props.onOp).toHaveBeenCalledWith({
      kind: "stroke",
      stroke: expect.objectContaining({
        author: "me",
        points: [[0.1, 0.25], [0.4, 0.75]],
      }),
    });
  });

  it("undoes only the caller's latest item and disables undo otherwise", () => {
    const otherOnly: Scene = {
      items: [
        {
          type: "stroke",
          id: "theirs",
          author: "them",
          at: 1,
          ink: "#e8b94a",
          width: 0.01,
          points: [[0, 0], [1, 1]],
        },
      ],
    };
    const first = makeProps(otherOnly);
    const view = render(<CreateSpace {...first} />);
    expect((screen.getByLabelText("Undo your last mark") as HTMLButtonElement).disabled).toBe(true);

    const mine: Scene = {
      items: [
        ...otherOnly.items,
        {
          type: "sticker",
          id: "mine",
          author: "me",
          at: 2,
          glyph: "⭐",
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
        },
      ],
    };
    const second = makeProps(mine);
    view.rerender(<CreateSpace {...second} />);
    fireEvent.click(screen.getByLabelText("Undo your last mark"));

    expect(second.onOp).toHaveBeenCalledWith({ kind: "remove", id: "mine" });
  });

  it("requires a second press before clearing both screens", () => {
    const props = makeProps();
    render(<CreateSpace {...props} />);
    const clear = screen.getByLabelText("Clear drawing for both people");

    fireEvent.click(clear);
    expect(props.onOp).not.toHaveBeenCalled();
    expect(screen.getByText("Clear for both?")).toBeTruthy();

    fireEvent.click(clear);
    expect(props.onOp).toHaveBeenCalledWith({ kind: "clear" });
  });

  it("does not move a sticker belonging to the other person", () => {
    const scene: Scene = {
      items: [
        {
          type: "sticker",
          id: "theirs",
          author: "them",
          at: 1,
          glyph: "⭐",
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
        },
      ],
    };
    const props = makeProps(scene);
    render(<CreateSpace {...props} />);
    const canvas = screen.getByLabelText("Shared drawing canvas");

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 140, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 140, clientY: 70, pointerId: 1 });

    expect(props.onOp).not.toHaveBeenCalled();
  });

  it("returns to the scene supplied by the parent after a local stroke", () => {
    const props = makeProps();
    const view = render(<CreateSpace {...props} />);
    const canvas = screen.getByLabelText("Shared drawing canvas");

    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 25, pointerId: 1 });
    view.rerender(<CreateSpace {...props} />);

    const sceneArguments = vi.mocked(paintScene).mock.calls.map((call) => call[1]);
    expect(sceneArguments.at(-1)).toBe(props.scene);
    expect(sceneArguments.at(-1)?.items).toEqual([]);
  });
});
