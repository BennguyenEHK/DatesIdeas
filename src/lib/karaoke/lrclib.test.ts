import { describe, expect, it } from "vitest";
import { chooseBest, findLyrics, searchUrl } from "./lrclib";

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("searchUrl", () => {
  it("encodes query parameters and omits a blank artist", () => {
    expect(searchUrl({ title: "A & B / 演歌", artist: "C & D / 歌手", durationSec: 120 })).toBe(
      "https://lrclib.net/api/search?track_name=A+%26+B+%2F+%E6%BC%94%E6%AD%8C&artist_name=C+%26+D+%2F+%E6%AD%8C%E6%89%8B",
    );
    expect(searchUrl({ title: "Song", artist: "   ", durationSec: 120 })).toBe(
      "https://lrclib.net/api/search?track_name=Song",
    );
  });
});

describe("chooseBest", () => {
  it("chooses the nearest duration", () => {
    expect(
      chooseBest(
        [
          { duration: 121, syncedLyrics: "[00:01] farther" },
          { duration: 120.2, syncedLyrics: "[00:01] nearest" },
          { duration: 119, syncedLyrics: "[00:01] also farther" },
        ],
        120,
      ),
    ).toBe("[00:01] nearest");
  });

  it("rejects a nearest match beyond the drift limit and accepts one within it", () => {
    expect(chooseBest([{ duration: 123.1, syncedLyrics: "[00:01] too far" }], 120)).toBeNull();
    expect(chooseBest([{ duration: 122.9, syncedLyrics: "[00:01] close enough" }], 120)).toBe(
      "[00:01] close enough",
    );
  });

  it("ignores entries without synced lyrics or with an uncomparable duration", () => {
    expect(
      chooseBest(
        [
          { duration: 120, plainLyrics: "static" },
          { duration: "120", syncedLyrics: "[00:01] wrong type" },
          { syncedLyrics: "[00:01] missing duration" },
          { duration: 119.5, syncedLyrics: "[00:01] valid" },
        ],
        120,
      ),
    ).toBe("[00:01] valid");
  });

  it.each([null, undefined, {}, [], [null], "text", 42])("returns null for malformed input: %s", (value) => {
    expect(chooseBest(value, 120)).toBeNull();
  });
});

describe("findLyrics", () => {
  const query = { title: "Song", artist: "Artist", durationSec: 120 };

  it("returns null when fetch rejects, the response is not successful, or JSON parsing fails", async () => {
    const rejected: typeof fetch = async () => Promise.reject(new Error("offline"));
    const notFound: typeof fetch = async () => response({}, false);
    const notJson: typeof fetch = async () => ({ ok: true, json: async () => Promise.reject(new Error("bad json")) } as unknown as Response);

    await expect(findLyrics(query, { fetch: rejected })).resolves.toBeNull();
    await expect(findLyrics(query, { fetch: notFound })).resolves.toBeNull();
    await expect(findLyrics(query, { fetch: notJson })).resolves.toBeNull();
  });

  it("returns synced lyrics and uses the injected fetch", async () => {
    let called = false;
    const injected: typeof fetch = async () => {
      called = true;
      return response([{ duration: 120.1, syncedLyrics: "[00:01] sing" }]);
    };

    await expect(findLyrics(query, { fetch: injected })).resolves.toBe("[00:01] sing");
    expect(called).toBe(true);
  });
});
