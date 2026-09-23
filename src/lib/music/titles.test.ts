import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  fetchTitles,
  fetchVideoInfo,
  knownVideoInfo,
  useVideoInfo,
} from "./titles";

// Each test uses its own ids: the cache lives for the page, which in a test
// file is the whole file.

function answering(
  byId: Record<string, { title: string; author: string } | number>,
) {
  const fetchMock = vi.fn(async (url: string) => {
    const id =
      new URL(url, "http://localhost").searchParams.get("videoId") ?? "";
    const answer = byId[id];
    if (typeof answer === "number") return new Response("", { status: answer });
    if (answer === undefined) return new Response("", { status: 404 });
    return new Response(JSON.stringify(answer), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchVideoInfo", () => {
  it("asks the app's own route and remembers the answer", async () => {
    const fetchMock = answering({
      aaaaaaaaaa1: { title: "Song", author: "Singer" },
    });

    expect(await fetchVideoInfo("aaaaaaaaaa1")).toEqual({
      title: "Song",
      author: "Singer",
    });
    expect(await fetchVideoInfo("aaaaaaaaaa1")).toEqual({
      title: "Song",
      author: "Singer",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oembed?videoId=aaaaaaaaaa1");
    expect(knownVideoInfo("aaaaaaaaaa1")).toEqual({
      title: "Song",
      author: "Singer",
    });
  });

  it("shares one request between two askers", async () => {
    const fetchMock = answering({
      aaaaaaaaaa2: { title: "Song", author: "Singer" },
    });
    await Promise.all([
      fetchVideoInfo("aaaaaaaaaa2"),
      fetchVideoInfo("aaaaaaaaaa2"),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("remembers a missing video without asking again", async () => {
    const fetchMock = answering({});
    expect(await fetchVideoInfo("aaaaaaaaaa3")).toBeNull();
    expect(await fetchVideoInfo("aaaaaaaaaa3")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("tries again after a failure that may be temporary", async () => {
    const fetchMock = answering({ aaaaaaaaaa4: 502 });
    expect(await fetchVideoInfo("aaaaaaaaaa4")).toBeNull();
    expect(await fetchVideoInfo("aaaaaaaaaa4")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws when the network does", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(fetchVideoInfo("aaaaaaaaaa5")).resolves.toBeNull();
  });
});

describe("fetchTitles", () => {
  it("returns only the titles that were found, by id", async () => {
    answering({ bbbbbbbbbb1: { title: "One", author: "A" }, bbbbbbbbbb2: 500 });
    expect(
      await fetchTitles(["bbbbbbbbbb1", "bbbbbbbbbb2", "bbbbbbbbbb3"]),
    ).toEqual({
      bbbbbbbbbb1: "One",
    });
  });
});

describe("useVideoInfo", () => {
  it("fills in once the lookup arrives, and follows a change of song", async () => {
    answering({
      ccccccccccc: { title: "First", author: "One" },
      ddddddddddd: { title: "Second", author: "Two" },
    });
    const { result, rerender } = renderHook(({ id }) => useVideoInfo(id), {
      initialProps: { id: "ccccccccccc" as string | null },
    });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.title).toBe("First"));

    rerender({ id: "ddddddddddd" });
    await waitFor(() => expect(result.current?.title).toBe("Second"));

    rerender({ id: null });
    expect(result.current).toBeNull();
  });
});
