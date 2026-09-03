import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_TYPE,
  extensionFor,
  keepsakeKey,
  MAX_UPLOAD_MB,
  randomToken,
  uploadKeepsake,
} from "./keepsake";

const blob = (size: number, type = "image/png"): Blob =>
  new Blob([new Uint8Array(size)], { type });

describe("keepsake helpers", () => {
  it("exports the upload limits", () => {
    expect(MAX_UPLOAD_MB).toEqual({ strip: 8, clip: 40 });
  });

  it("exports the storage content types", () => {
    expect(CONTENT_TYPE).toEqual({ strip: "image/png", clip: "video/webm" });
  });

  it("uses png for strips regardless of mime type", () => {
    expect(extensionFor("strip", "video/mp4")).toBe("png");
  });

  it("uses webm for clips by default", () => {
    expect(extensionFor("clip")).toBe("webm");
  });

  it("uses webm for a null clip mime type", () => {
    expect(extensionFor("clip", null)).toBe("webm");
  });

  it("uses mp4 when the clip mime type contains mp4", () => {
    expect(extensionFor("clip", "video/MP4; codecs=avc1")).toBe("mp4");
  });

  it("uses webm for other clip mime types", () => {
    expect(extensionFor("clip", "video/webm")).toBe("webm");
  });

  it("builds a namespaced keepsake key", () => {
    expect(keepsakeKey("ABC_12", "strip", "png", "deadbeef")).toBe(
      "keepsakes/ABC_12/strip-deadbeef.png",
    );
  });

  it("rejects an empty room", () => {
    expect(() => keepsakeKey("", "strip", "png", "token")).toThrow(TypeError);
  });

  it("rejects an empty token", () => {
    expect(() => keepsakeKey("room", "strip", "png", "")).toThrow(TypeError);
  });

  it("rejects a slash in a room", () => {
    expect(() => keepsakeKey("room/other", "strip", "png", "token")).toThrow(TypeError);
  });

  it("rejects dot-dot in a room", () => {
    expect(() => keepsakeKey("room..other", "strip", "png", "token")).toThrow(TypeError);
  });

  it("creates an eight-byte lowercase hex token", () => {
    const token = randomToken();
    expect(token).toHaveLength(16);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("creates a requested token length", () => {
    expect(randomToken(3)).toMatch(/^[0-9a-f]{6}$/);
  });

  it("falls back when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(randomToken(2)).toBe("8080");
    expect(random).toHaveBeenCalled();
    random.mockRestore();
    vi.unstubAllGlobals();
  });

  it("rejects an oversized strip before any fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await uploadKeepsake(blob(8 * 1024 * 1024 + 1), {
      room: "room",
      kind: "strip",
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, error: "too big to send (9MB, limit 8MB)" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized clip before any fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await uploadKeepsake(blob(42 * 1024 * 1024), {
      room: "room",
      kind: "clip",
      fetchImpl,
    });
    expect(result.error).toBe("too big to send (42MB, limit 40MB)");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a zero-size blob", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await uploadKeepsake(blob(0), { room: "room", kind: "strip", fetchImpl });
    expect(result).toEqual({ ok: false, error: "nothing to send" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a closed room", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 410 }));
    await expect(uploadKeepsake(blob(1), { room: "room", kind: "strip", fetchImpl })).resolves.toEqual({
      ok: false,
      error: "this room has closed",
    });
  });

  it("surfaces a server JSON error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "room is not yours" }), { status: 500 }),
    );
    await expect(uploadKeepsake(blob(1), { room: "room", kind: "strip", fetchImpl })).resolves.toEqual({
      ok: false,
      error: "room is not yours",
    });
  });

  it("uses a generic message for an unparseable server error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not json", { status: 500 }),
    );
    const result = await uploadKeepsake(blob(1), { room: "room", kind: "strip", fetchImpl });
    expect(result).toEqual({ ok: false, error: "could not get an upload link" });
  });

  it("rejects a ticket missing its download URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ uploadUrl: "https://upload", key: "key" }), { status: 200 }),
    );
    const result = await uploadKeepsake(blob(1), { room: "room", kind: "strip", fetchImpl });
    expect(result).toEqual({ ok: false, error: "the upload link came back incomplete" });
  });

  it("reports a refused PUT", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uploadUrl: "https://upload", downloadUrl: "https://download", key: "key" })))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const result = await uploadKeepsake(blob(1), { room: "room", kind: "strip", fetchImpl });
    expect(result).toEqual({ ok: false, error: "the upload was refused" });
  });

  it("turns a thrown fetch into a friendly failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const result = await uploadKeepsake(blob(1), { room: "room", kind: "strip", fetchImpl });
    expect(result).toEqual({ ok: false, error: "the upload could not finish" });
  });

  /**
   * The type must follow the actual bytes. This once asserted "video/webm" for
   * an MP4 blob, which is what the code did -- and a file stored under the
   * wrong type is one a phone downloads and then refuses to play.
   */
  it("declares the format the blob actually is, not a fixed one", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadUrl: "https://upload", downloadUrl: "https://download", key: "key" })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const source = blob(12, "video/mp4");
    const result = await uploadKeepsake(source, {
      room: "ROOM_1",
      kind: "clip",
      mimeType: "video/mp4",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, url: "https://download" });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/keepsake", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        room: "ROOM_1",
        kind: "clip",
        contentType: "video/mp4",
        extension: "mp4",
        sizeBytes: 12,
      }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://upload", expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: source,
    }));
  });
});
