import { describe, expect, it, vi } from "vitest";
import { createLookbookClient } from "./client";

const piece = {
  id: "piece01",
  kind: "top",
  label: "shirt",
  addedBy: "me",
  url: "https://x",
  createdAt: "2026-01-01",
};
const outfit = {
  id: "outfit01",
  name: "Outfit 1",
  wearOn: null,
  note: "",
  createdBy: "me",
  lovedBy: [],
  layout: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("lookbook client", () => {
  it("uses the complete presign, upload, confirm path with injected shrinking", async () => {
    const shrink = vi.fn(async () => new Blob(["small"], { type: "image/jpeg" }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({ id: "piece01", key: "key", uploadUrl: "https://upload", receipt: "receipt" }),
      )
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ piece }));
    const result = await createLookbookClient({ fetchImpl, shrink }).addPiece(
      new Blob(["x"], { type: "image/png" }),
      { kind: "top", label: "shirt", addedBy: "me" },
    );
    expect(result).toEqual({ ok: true, value: piece });
    expect(shrink).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
    });
    expect(fetchImpl.mock.calls[2][1].body).toContain("receipt");
  });
  it("surfaces 401 and refuses malformed server bodies", async () => {
    const unauthorized = await createLookbookClient({
      fetchImpl: vi.fn().mockResolvedValue(response({ error: "no" }, 401)),
    }).listPieces();
    expect(unauthorized).toMatchObject({ ok: false, status: 401 });
    const malformed = await createLookbookClient({
      fetchImpl: vi.fn().mockResolvedValue(response({ outfits: [outfit] })),
    }).listPieces();
    expect(malformed).toMatchObject({ ok: false, status: 200 });
  });
  it("does not throw when object storage rejects an upload", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({ id: "piece01", key: "key", uploadUrl: "https://upload", receipt: "receipt" }),
      )
      .mockResolvedValueOnce(response({}, 500));
    await expect(
      createLookbookClient({ fetchImpl }).addPiece(new Blob(["x"], { type: "image/jpeg" }), {
        kind: "top",
        label: "",
        addedBy: "me",
      }),
    ).resolves.toMatchObject({ ok: false, status: 500 });
  });
});
