import { describe, expect, it, vi } from "vitest";
import {
  fetchTrack,
  HELPER_MESSAGE,
  isYouTubeUrl,
  type HelperFailure,
} from "./helperClient";

const failures: Record<HelperFailure, true> = {
  "helper-unreachable": true,
  unauthorized: true,
  "bad-url": true,
  "not-found": true,
  "extract-failed": true,
  "too-large": true,
};

function response(status: number, bytes = new Uint8Array(1024)): Response {
  return new Response(bytes, { status });
}

describe("isYouTubeUrl", () => {
  it("accepts supported YouTube link shapes", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/abc123")).toBe(true);
    expect(isYouTubeUrl("https://music.youtube.com/watch?v=abc123")).toBe(true);
    expect(isYouTubeUrl("https://youtube.com/shorts/abc123")).toBe(true);
  });

  it("rejects non-YouTube and lookalike links", () => {
    expect(isYouTubeUrl("https://vimeo.com/123")).toBe(false);
    expect(isYouTubeUrl("abc123")).toBe(false);
    expect(isYouTubeUrl("")).toBe(false);
    expect(isYouTubeUrl("https://youtube.com.evil.test/watch?v=abc123")).toBe(false);
  });
});

describe("fetchTrack", () => {
  it("posts the URL with the bearer token to the extract endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(200));

    await fetchTrack("http://helper.test/", "secret", "https://youtu.be/abc", { fetch });

    expect(fetch).toHaveBeenCalledWith("http://helper.test/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify({ url: "https://youtu.be/abc" }),
    });
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [400, "bad-url"],
    [404, "not-found"],
    [413, "too-large"],
    [500, "extract-failed"],
    [418, "extract-failed"],
  ] as const)("maps HTTP %s to %s", async (status, reason) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(status));
    await expect(fetchTrack("http://helper.test", "secret", "https://youtu.be/abc", { fetch })).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it("reports a rejected fetch as unreachable", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
    await expect(fetchTrack("http://helper.test", "secret", "https://youtu.be/abc", { fetch })).resolves.toEqual({
      ok: false,
      reason: "helper-unreachable",
    });
  });

  it("rejects a short successful response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(200, new Uint8Array(10)));
    await expect(fetchTrack("http://helper.test", "secret", "https://youtu.be/abc", { fetch })).resolves.toEqual({
      ok: false,
      reason: "extract-failed",
    });
  });

  it("returns intact audio and decoded metadata", async () => {
    const bytes = Uint8Array.from({ length: 1024 }, (_, index) => index % 251);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "audio/mp4",
          "X-Track-Title": encodeURIComponent("Cà phê"),
          "X-Track-Duration": "123.45",
          "X-Track-Lrc": encodeURIComponent("[00:01.00] hello"),
        },
      }),
    );

    const result = await fetchTrack("http://helper.test", "secret", "https://youtu.be/abc", { fetch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.track.audio.byteLength).toBe(bytes.byteLength);
      expect(new Uint8Array(result.track.audio)[10]).toBe(bytes[10]);
      expect(result.track).toMatchObject({
        contentType: "audio/mp4",
        title: "Cà phê",
        durationSec: 123.45,
        lrc: "[00:01.00] hello",
      });
    }
  });

  it("allows absent lyrics", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(new Uint8Array(1024), {
        headers: { "X-Track-Title": "Song", "X-Track-Duration": "10" },
      }),
    );
    const result = await fetchTrack("http://helper.test", "secret", "https://youtu.be/abc", { fetch });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.track.lrc).toBeNull();
  });

  it("reports malformed encoded headers without throwing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(new Uint8Array(1024), {
        headers: { "X-Track-Title": "%E0%A4%A", "X-Track-Duration": "10" },
      }),
    );
    await expect(fetchTrack("http://helper.test", "secret", "https://youtu.be/abc", { fetch })).resolves.toEqual({
      ok: false,
      reason: "extract-failed",
    });
  });

  it("has a message for every failure", () => {
    for (const failure of Object.keys(failures) as HelperFailure[]) {
      expect(HELPER_MESSAGE[failure]).toEqual(expect.any(String));
    }
  });
});
