import { describe, expect, it, vi } from "vitest";
import { addToAlbum } from "./upload";

const item = {
  id: "item-1",
  kind: "video" as const,
  contentType: "video/mp4",
  bytes: 4,
  happenedAt: "2026-09-11T12:00:00.000Z",
  createdAt: "2026-09-11T12:00:00.000Z",
  caption: null,
  loved: false,
  sourceRoom: null,
  url: "https://example.test/video",
  posterUrl: null,
};

describe("addToAlbum", () => {
  it("presigns, uploads the original and poster, then confirms in order", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          id: "item-1",
          uploadUrl: "https://storage.test/video",
          posterUploadUrl: "https://storage.test/poster",
          happenedAt: "2026-09-11T12:00:00.000Z",
          objectKey: "album/pair/video-1.mp4",
          receipt: "receipt-1",
          kind: "video",
        }), { status: 200 });
      }
      if (calls.length === 4) return new Response(JSON.stringify({ item }), { status: 200 });
      return new Response(null, { status: 200 });
    });

    const result = await addToAlbum(new Blob(["data"], { type: "video/mp4" }), {
      kind: "video",
      contentType: "video/mp4",
      happenedAt: "2026-09-11T10:00:00.000Z",
      poster: new Blob(["poster"], { type: "image/jpeg" }),
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, item });
    expect(calls.map((call) => call.url)).toEqual([
      "/api/album",
      "https://storage.test/video",
      "https://storage.test/poster",
      "/api/album",
    ]);
    expect(new Headers(calls[1]?.init?.headers).get("Content-Type")).toBe("video/mp4");
    expect(new Headers(calls[2]?.init?.headers).get("Content-Type")).toBe("image/jpeg");
    // The phone's clock at the moment the memory happened decides its folder.
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      utcOffsetMinutes: -new Date("2026-09-11T10:00:00.000Z").getTimezoneOffset() + 0,
    });
    expect(JSON.parse(String(calls[3]?.init?.body))).toMatchObject({
      objectKey: "album/pair/video-1.mp4",
      receipt: "receipt-1",
      kind: "video",
      contentType: "video/mp4",
      sizeBytes: 4,
      happenedAt: "2026-09-11T12:00:00.000Z",
      posterUploaded: true,
    });
  });

  it("confirms successfully when the poster PUT fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "item-1",
          uploadUrl: "https://storage.test/video",
          posterUploadUrl: "https://storage.test/poster",
          happenedAt: "2026-09-11T12:00:00.000Z",
          objectKey: "album/pair/video-1.mp4",
          receipt: "receipt-1",
          kind: "video",
        }), { status: 200 });
      }
      if (String(_input).endsWith("poster")) return new Response(null, { status: 500 });
      if (init?.method === "PUT" && String(_input) === "/api/album") {
        return new Response(JSON.stringify({ item }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    });

    const result = await addToAlbum(new Blob(["data"]), {
      kind: "video",
      contentType: "video/mp4",
      poster: new Blob(["poster"]),
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    const confirmCall = fetchImpl.mock.calls.at(-1);
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({ posterUploaded: false });
  });

  it("passes the server's own refusal through instead of a generic line", async () => {
    // The server's sentence is the only one that says what to do about it.
    // Replacing "that file type is not allowed here" with "could not get an
    // upload link" leaves the person with no next action.
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: "sharing by QR is not set up for this app yet" }), {
          status: 503,
        }),
    );
    const result = await addToAlbum(new Blob(["data"]), {
      kind: "photo",
      contentType: "image/jpeg",
      fetchImpl,
    });
    expect(result).toEqual({
      ok: false,
      error: "sharing by QR is not set up for this app yet",
    });
  });

  it("explains an unpaired device rather than repeating the server's 401", async () => {
    // The server cannot phrase this one: it does not know whether this is a
    // new phone or a ticket that was rotated away this morning.
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    const result = await addToAlbum(new Blob(["data"]), {
      kind: "photo",
      contentType: "image/jpeg",
      fetchImpl,
    });
    expect(result.error).toBe("this device is not paired yet");
  });

  it("retries the storage PUT once on a network error, then gives up", async () => {
    let puts = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            id: "item-1",
            uploadUrl: "https://storage.test/photo",
            happenedAt: "2026-09-11T12:00:00.000Z",
            objectKey: "album/pair/photo-1.jpg",
            receipt: "receipt-1",
            kind: "photo",
          }),
          { status: 200 },
        );
      }
      if (String(input) === "https://storage.test/photo") {
        puts += 1;
        throw new TypeError("network down");
      }
      return new Response(null, { status: 200 });
    });

    const result = await addToAlbum(new Blob(["data"]), {
      kind: "photo",
      contentType: "image/jpeg",
      fetchImpl,
    });

    expect(puts).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("treats a presign reply without a receipt as incomplete", async () => {
    // Without it the confirm would be refused anyway, after a full upload.
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        id: "item-1",
        uploadUrl: "https://storage.test/photo",
        happenedAt: "2026-09-11T12:00:00.000Z",
        objectKey: "album/pair/photo-1.jpg",
        kind: "photo",
      }), { status: 200 }),
    );
    const result = await addToAlbum(new Blob(["data"]), { kind: "photo", contentType: "image/jpeg", fetchImpl });
    expect(result).toEqual({ ok: false, error: "the upload link came back incomplete" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a content type the album does not hold, before any network call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await addToAlbum(new Blob(["data"]), {
      kind: "photo",
      contentType: "text/html",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes no network calls for an oversize file", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await addToAlbum(new Blob([new Uint8Array(201 * 1024 * 1024)]), {
      kind: "video",
      contentType: "video/mp4",
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, error: "too big to send (201MB, limit 200MB)" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
