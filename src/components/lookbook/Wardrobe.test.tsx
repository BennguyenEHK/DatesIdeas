import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Wardrobe } from "./Wardrobe";
import type { LookbookView } from "@/lib/lookbook/contract";
const piece = {
  id: "piece01",
  kind: "top" as const,
  label: "Silk",
  addedBy: "me",
  url: "photo",
  createdAt: "now",
};
const makeView = (
  open: LookbookView["open"] = {
    id: "outfit1",
    name: "Look",
    wearOn: null,
    note: "",
    createdBy: "me",
    lovedBy: [],
    layout: [],
    createdAt: "",
    updatedAt: "",
  },
) =>
  ({
    pieces: [piece],
    open,
    me: "me",
    adding: false,
    updatePiece: vi.fn(),
    deletePiece: vi.fn(),
    place: vi.fn(),
  }) as unknown as LookbookView;
describe("Wardrobe", () => {
  it("groups pieces and places a board piece at the centre", () => {
    const v = makeView();
    render(<Wardrobe view={v} />);
    expect(screen.getByRole("heading", { name: "Tops" })).toBeTruthy();
    screen.getByRole("button", { name: /Silk/ }).click();
    expect(v.place).toHaveBeenCalledWith({ pieceId: "piece01", x: 0.5, y: 0.5, scale: 1, z: 0 });
  });
  it("does not add a piece already on the board", () => {
    const v = makeView({
      ...makeView().open!,
      layout: [{ pieceId: "piece01", x: 0.5, y: 0.5, scale: 1, z: 0 }],
    });
    render(<Wardrobe view={v} />);
    expect(screen.getByText("on board")).toBeTruthy();
    screen.getByRole("button", { name: /Silk/ }).click();
    expect(v.place).not.toHaveBeenCalled();
  });
});
