import { describe, expect, it, vi } from "vitest";
import { createLooksClient } from "./client";

const look = {
  id: "abcdef",
  name: "Glow",
  shots: 2,
  ink: "#123abc",
  backdropUrl: "get:b",
  overlayUrl: "get:o",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("looks client", () => {
  it("presigns, uploads both PNG layers, then confirms", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: "abcdef",
          receipt: "r",
          backdropKey: "b",
          overlayKey: "o",
          backdropUploadUrl: "put:b",
          overlayUploadUrl: "put:o",
        }),
      )
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ look }));
    const client = createLooksClient(fetch);
    const result = await client.save({
      name: "Glow",
      shots: 2,
      ink: "#123abc",
      backdrop: new Blob(["b"]),
      overlay: new Blob(["o"]),
    });
    expect(result).toEqual({ ok: true, look });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/looks", "put:b", "put:o", "/api/looks"]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "image/png" },
    });
  });

  async function savedWith(answers: Response[]) {
    const fetch = vi.fn();
    answers.forEach((answer) => fetch.mockResolvedValueOnce(answer));
    const result = await createLooksClient(fetch).save({
      name: "Glow",
      shots: 2,
      ink: "#123abc",
      backdrop: new Blob(["b"]),
      overlay: new Blob(["o"]),
    });
    expect(result.ok).toBe(false);
  }

  it("resolves an error when presigning fails", async () => {
    await savedWith([response({ error: "no" }, 500)]);
  });

  it("resolves an error when a layer upload fails", async () => {
    await savedWith([
      response({
        id: "abcdef",
        receipt: "r",
        backdropKey: "b",
        overlayKey: "o",
        backdropUploadUrl: "put:b",
        overlayUploadUrl: "put:o",
      }),
      response({}, 500),
    ]);
  });

  it("resolves an error when confirmation fails", async () => {
    await savedWith([
      response({
        id: "abcdef",
        receipt: "r",
        backdropKey: "b",
        overlayKey: "o",
        backdropUploadUrl: "put:b",
        overlayUploadUrl: "put:o",
      }),
      response({}),
      response({}),
      response({ error: "no" }, 500),
    ]);
  });

  it("uses the pairing sentence for a 401", async () => {
    const result = await createLooksClient(vi.fn().mockResolvedValue(response({}, 401))).list();
    expect(result).toEqual({ ok: false, error: "Pair this device to keep designed looks." });
  });
});
