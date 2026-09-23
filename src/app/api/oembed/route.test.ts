import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const ID = "dQw4w9WgXcQ";

function ask(videoId: string | null) {
  const url = new URL("http://localhost/api/oembed");
  if (videoId !== null) url.searchParams.set("videoId", videoId);
  return GET(new Request(url));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/oembed", () => {
  it("refuses an id that is not a YouTube video id, without asking YouTube", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect((await ask(null)).status).toBe(400);
    expect((await ask("short")).status).toBe(400);
    expect((await ask("../../etc/pw")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the title and author, cached for a day", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            title: "Điều Anh Biết",
            author_name: "Chi Dân",
            html: "<iframe>",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await ask(ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      title: "Điều Anh Biết",
      author: "Chi Dân",
    });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${ID}&format=json`,
    );
  });

  it("passes a missing video on as 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })),
    );
    expect((await ask(ID)).status).toBe(404);
  });

  it("answers 502 when YouTube fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("oops", { status: 500 })),
    );
    expect((await ask(ID)).status).toBe(502);
  });

  it("answers 502 when YouTube cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    expect((await ask(ID)).status).toBe(502);
  });

  it("answers 502 when YouTube's answer has no title", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
    expect((await ask(ID)).status).toBe(502);
  });

  it("gives up on a YouTube that never answers", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise((_, reject) => {
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
      );
      const pending = ask(ID);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).status).toBe(502);
    } finally {
      vi.useRealTimers();
    }
  });
});
