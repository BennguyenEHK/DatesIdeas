import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const ID = "dQw4w9WgXcQ";
const ask = (q: string | null) => {
  const url = new URL("http://localhost/api/music/search");
  if (q !== null) url.searchParams.set("q", q);
  return GET(new Request(url));
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /api/music/search", () => {
  it("requires a short-lived optional key and a valid query", async () => {
    expect((await ask(null)).status).toBe(400);
    expect((await ask(" ")).status).toBe(400);
    vi.stubEnv("YOUTUBE_API_KEY", "");
    expect((await ask("song")).status).toBe(503);
  });

  it("maps, filters, and decodes YouTube results", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [
      { id: { videoId: ID }, snippet: { title: "Rock &amp; Roll &#39;Live&#39;", channelTitle: "A &quot;channel&quot;", thumbnails: { default: { url: "thumb" } } } },
      { id: { videoId: "bad" }, snippet: { title: "drop", channelTitle: "drop" } },
    ] })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await ask("  rock & roll  ");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ videoId: ID, title: "Rock & Roll 'Live'", channel: 'A "channel"', thumbnail: "thumb" }] });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(String(fetchMock.mock.calls[0][0])).toContain("key=secret");
  });

  it("maps quota failures to unavailable", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("quota", { status: 403 })));
    expect((await ask("song")).status).toBe(503);
  });

  it("times out after five seconds", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "secret");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const pending = ask("song");
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe(502);
  });

  it("decodes an escaped ampersand only once", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [
      { id: { videoId: ID }, snippet: { title: "a &amp;lt;b&amp;gt;", channelTitle: "c" } },
    ] }))));
    const body = await (await ask("ab")).json();
    expect(body.results[0].title).toBe("a &lt;b&gt;");
  });
});

