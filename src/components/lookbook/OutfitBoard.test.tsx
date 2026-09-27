import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutfitBoard } from "./OutfitBoard";
import type { LookbookView } from "@/lib/lookbook/contract";
const outfit = {
  id: "outfit1",
  name: "Friday",
  wearOn: null,
  note: "",
  createdBy: "me",
  lovedBy: ["me"],
  layout: [{ pieceId: "piece01", x: 0.5, y: 0.5, scale: 1, z: 0 }],
  createdAt: "",
  updatedAt: "",
};
const piece = {
  id: "piece01",
  kind: "top" as const,
  label: "Top",
  addedBy: "me",
  url: "photo",
  createdAt: "",
};
describe("OutfitBoard", () => {
  it("reflects heart and emits clamped pointer movement", () => {
    const view = {
      pieces: [piece],
      me: "me",
      toggleLove: vi.fn(),
      place: vi.fn(),
      unplace: vi.fn(),
      setWearOn: vi.fn(),
      setNote: vi.fn(),
      rename: vi.fn(),
      deleteOutfit: vi.fn(),
    } as unknown as LookbookView;
    render(<OutfitBoard view={view} outfit={outfit} onKeepInAlbum={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Heart outfit" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    const board = screen.getByRole("button", { name: "Top" });
    const parent = board.parentElement!;
    Object.defineProperty(parent, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 300, height: 400 }),
    });
    Object.defineProperty(board, "setPointerCapture", { value: vi.fn() });
    // Grabbed at its centre and dragged off the board: clamped to the edge.
    fireEvent.pointerDown(board, { clientX: 150, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(board, { clientX: -10, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(board, { clientX: -10, clientY: 500, pointerId: 1 });
    expect(view.place).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0, y: 1 }));
  });
});

describe("OutfitBoard, handling a piece", () => {
  function setup() {
    const view = {
      pieces: [piece],
      me: "me",
      toggleLove: vi.fn(),
      place: vi.fn(),
      unplace: vi.fn(),
      setWearOn: vi.fn(),
      setNote: vi.fn(),
      rename: vi.fn(),
      deleteOutfit: vi.fn(),
    } as unknown as LookbookView;
    render(<OutfitBoard view={view} outfit={outfit} onKeepInAlbum={vi.fn()} />);
    const handle = screen.getByRole("button", { name: "Top" });
    Object.defineProperty(handle.parentElement!, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 300, height: 400 }),
    });
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
    return { view, handle };
  }

  it("does not move a piece that is only tapped to select it", () => {
    const { view, handle } = setup();
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 120, pointerId: 1 });
    expect(view.place).not.toHaveBeenCalled();
  });

  it("keeps the piece where it was grabbed, rather than jumping its centre to the finger", () => {
    const { view, handle } = setup();
    // The piece's centre is at (150, 200); grabbed 10px right and below it.
    fireEvent.pointerDown(handle, { clientX: 160, clientY: 210, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 70, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 70, clientY: 110, pointerId: 1 });
    const last = vi.mocked(view.place).mock.calls.at(-1)?.[0];
    expect(last?.x).toBeCloseTo(0.2, 5);
    expect(last?.y).toBeCloseTo(0.25, 5);
  });

  it("does not remove the selected piece while someone types Backspace in the note", () => {
    const { view, handle } = setup();
    fireEvent.click(handle);
    const note = screen.getByRole("textbox", { name: /note/i });
    fireEvent.keyDown(note, { key: "Backspace" });
    expect(view.unplace).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(view.unplace).toHaveBeenCalledWith("piece01");
  });
});
