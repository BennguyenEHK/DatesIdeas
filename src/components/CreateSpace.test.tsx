import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addToAlbum } from "@/lib/album/upload";
import type { Scene } from "@/lib/createspace/ops";
import { MENU_SESSION, type CreateSession } from "@/lib/createspace/session";
import { CreateSpace, type CreateSpaceProps } from "./CreateSpace";

vi.mock("@/lib/album/upload", () => ({ addToAlbum: vi.fn() }));
vi.mock("./PicturePicker", () => ({
  PicturePicker: ({ onPick }: { onPick: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onPick("picture-1")}>
        Album picture
      </button>
      <button type="button" onClick={() => onPick(null)}>
        Blank page
      </button>
    </>
  ),
}));

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

function session(patch: Partial<CreateSession> = {}): CreateSession {
  return { ...MENU_SESSION, ...patch };
}

function props(patch: Partial<CreateSpaceProps> = {}): CreateSpaceProps {
  return {
    identity: "me",
    room: "room-1",
    sharedNow: () => 100,
    scene: { items: [] },
    baseItemId: null,
    session: MENU_SESSION,
    onOp: vi.fn(),
    onBase: vi.fn(),
    onSession: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    editStripUrl: null,
    onFinishEdit: vi.fn(),
    localStream: null,
    remoteStream: null,
    paired: true,
    ...patch,
  };
}

function canvasContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectangle);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext());
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["picture"])));
  vi.mocked(addToAlbum).mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CreateSpace", () => {
  it("opens a fresh photo strip from the workshop menu", () => {
    const input = props();
    render(<CreateSpace {...input} />);

    fireEvent.click(screen.getByRole("button", { name: /photo strip/i }));

    expect(input.onOp).toHaveBeenCalledWith({ kind: "clear" });
    expect(input.onSession).toHaveBeenCalledWith({
      workshop: "strip",
      mode: "new",
      shots: 1,
      paper: "#ffffff",
      backdrop: null,
      merge: false,
    });
  });

  it("opens the shared drawing workshop from the menu", () => {
    const input = props();
    render(<CreateSpace {...input} />);
    fireEvent.click(screen.getByRole("button", { name: /draw together/i }));
    expect(input.onSession).toHaveBeenCalledWith({ workshop: "doodle" });
  });

  it("draws over a developed strip and saves it back to the booth", () => {
    const input = props({
      session: session({ workshop: "strip", mode: "edit" }),
      editStripUrl: "blob:developed-strip",
    });
    render(<CreateSpace {...input} />);
    const canvas = screen.getByLabelText("Photo strip drawing canvas");

    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 25, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 75, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 75, pointerId: 1 });

    expect(input.onOp).toHaveBeenCalledWith({
      kind: "stroke",
      stroke: expect.objectContaining({
        author: "me",
        points: [
          [0.1, 0.25],
          [0.4, 0.75],
        ],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(input.onFinishEdit).toHaveBeenCalledOnce();
  });

  it("uses an inline second step before discarding an edited strip", () => {
    const input = props({
      session: session({ workshop: "strip", mode: "edit" }),
      editStripUrl: "blob:developed-strip",
    });
    render(<CreateSpace {...input} />);

    fireEvent.click(screen.getByRole("button", { name: /back to booth/i }));
    expect(input.onOp).not.toHaveBeenCalled();
    expect(input.onFinishEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /discard edits/i }));
    expect(input.onOp).toHaveBeenCalledWith({ kind: "clear" });
    expect(input.onFinishEdit).toHaveBeenCalledOnce();
  });

  it("shows an album picture on the shared drawing canvas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "picture-1",
            url: "album-picture.jpg",
            happenedAt: "2026-09-13T00:00:00.000Z",
          },
        ],
      }),
    );
    const input = props({
      session: session({ workshop: "doodle" }),
      baseItemId: "picture-1",
    });
    render(<CreateSpace {...input} />);

    expect(
      (await screen.findByAltText("The selected album picture")).getAttribute("src"),
    ).toBe("album-picture.jpg");
  });

  it("asks before changing the doodle picture and clearing both screens", () => {
    const input = props({ session: session({ workshop: "doodle" }) });
    render(<CreateSpace {...input} />);

    fireEvent.click(screen.getByRole("button", { name: "Album picture" }));
    expect(input.onBase).not.toHaveBeenCalled();
    expect(input.onOp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use picture" }));
    expect(input.onBase).toHaveBeenCalledWith("picture-1");
    expect(input.onOp).toHaveBeenCalledWith({ kind: "clear" });
  });

  it("keeps the shared drawing in the album as a strip from this room", async () => {
    const input = props({ session: session({ workshop: "doodle" }) });
    render(<CreateSpace {...input} />);

    fireEvent.click(screen.getByRole("button", { name: "Keep in the album" }));

    await vi.waitFor(() => expect(addToAlbum).toHaveBeenCalledOnce());
    expect(addToAlbum).toHaveBeenCalledWith(expect.any(Blob), {
      kind: "strip",
      contentType: "image/png",
      sourceRoom: "room-1",
    });
  });

  it("resizes the selected sticker instead of only changing the next sticker", () => {
    const stickerScene: Scene = {
      items: [
        {
          type: "sticker",
          id: "mine",
          author: "me",
          at: 1,
          glyph: "⭐",
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
        },
      ],
    };
    const input = props({
      scene: stickerScene,
      session: session({ workshop: "strip", mode: "edit" }),
      editStripUrl: "blob:developed-strip",
    });
    render(<CreateSpace {...input} />);

    fireEvent.pointerDown(screen.getByLabelText("Photo strip drawing canvas"), {
      clientX: 100,
      clientY: 50,
      pointerId: 1,
    });
    fireEvent.change(screen.getByLabelText("Sticker size"), { target: { value: "1.8" } });

    expect(input.onOp).toHaveBeenCalledWith({
      kind: "sticker",
      sticker: expect.objectContaining({ id: "mine", scale: 1.8 }),
    });
  });

  it("does not undo while the hex field is being edited", () => {
    const input = props({
      session: session({ workshop: "strip" }),
      canUndo: true,
    });
    render(<CreateSpace {...input} />);
    const hex = screen.getByLabelText("Colour hex value");
    hex.focus();

    fireEvent.keyDown(hex, { key: "z", ctrlKey: true });

    expect(input.undo).not.toHaveBeenCalled();
  });
});
