import { afterEach, describe, expect, it, vi } from "vitest";
import { searchVideos } from "./search";

afterEach(() => vi.unstubAllGlobals());

describe("searchVideos", () => {
  it("caches a normalized query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchVideos("  jazz ")).resolves.toEqual({ results: [] });
    await expect(searchVideos("jazz")).resolves.toEqual({ results: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps an unavailable server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(searchVideos("unique unavailable query")).resolves.toEqual({ unavailable: true });
  });

  it("forgets a failed search so asking again tries again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchVideos("flaky query")).resolves.toEqual({ error: true });
    await Promise.resolve();
    await expect(searchVideos("flaky query")).resolves.toEqual({ results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
