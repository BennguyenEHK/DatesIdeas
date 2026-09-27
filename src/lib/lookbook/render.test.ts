import { describe, expect, it, vi } from "vitest";
import { renderOutfitPng } from "./render";
const outfit = {
  id: "outfit1",
  name: "Look",
  wearOn: null,
  note: "",
  createdBy: "me",
  lovedBy: [],
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
describe("renderOutfitPng", () => {
  it("loads and draws pieces in a 3:4 board", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage }),
      toBlob: (done: BlobCallback) => done(new Blob(["png"], { type: "image/png" })),
    };
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLElement);
    const result = await renderOutfitPng(outfit, [piece], {
      width: 300,
      loadImage: vi.fn().mockResolvedValue({ width: 100, height: 200 }),
    });
    expect(result).not.toBeNull();
    expect(drawImage).toHaveBeenCalled();
  });
  it("returns null when an image fails", async () => {
    expect(
      await renderOutfitPng(outfit, [piece], { loadImage: vi.fn().mockRejectedValue(new Error()) }),
    ).toBeNull();
  });
});
