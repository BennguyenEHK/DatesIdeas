import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSignaling, type SignalMessage } from "./useSignaling";

const handlers = {
  onPeer: () => {},
  onOffer: () => {},
  onAnswer: () => {},
  onIce: () => {},
};

let fetchMock: ReturnType<typeof vi.fn>;

const empty = () =>
  new Response(JSON.stringify({ signals: [], cursor: 0 }), { status: 200 });

const sentMessages = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)).payload as SignalMessage)
    .filter((message) => message.kind !== "join");

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function render() {
  return renderHook(() => useSignaling("ABCDEF", handlers, true, true));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fetchMock = vi.fn((url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? Promise.resolve(new Response("{}", { status: 201 }))
      : Promise.resolve(empty()),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reliable signaling sends", () => {
  it("retries a rejected POST and eventually delivers it", async () => {
    let attempts = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(empty());
      if (attempts++ === 0) return Promise.resolve(new Response("{}", { status: 201 }));
      if (attempts === 2) return Promise.reject(new Error("offline"));
      return Promise.resolve(new Response("{}", { status: 201 }));
    });
    const { result } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "peer" });
    await settle();
    expect(sentMessages()).toHaveLength(1);
    await advance(500);
    expect(sentMessages()).toEqual([
      { kind: "rebuild", from: "peer" },
      { kind: "rebuild", from: "peer" },
    ]);
  });

  it("doubles retry backoff and caps it at 8 seconds", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(empty()),
    );
    const { result } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "peer" });
    await settle();
    expect(sentMessages()).toHaveLength(1);
    let expectedAttempts = 1;
    for (const delay of [500, 1_000, 2_000, 4_000, 8_000]) {
      await advance(delay);
      expectedAttempts += 1;
      expect(sentMessages()).toHaveLength(expectedAttempts);
    }
    await advance(8_000);
    expect(sentMessages()).toHaveLength(7);
  });

  it("keeps messages in order with only one request in flight", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(empty());
      if (sentMessages().length === 0) return Promise.resolve(new Response("{}", { status: 201 }));
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    });
    const { result } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "one" });
    result.current.send({ kind: "restart-request", from: "two" });
    await settle();
    expect(sentMessages().map((message) => message.kind)).toEqual(["rebuild"]);
    expect(resolveFirst).toBeDefined();
    resolveFirst?.(new Response("{}", { status: 201 }));
    await settle();
    expect(sentMessages().map((message) => message.kind)).toEqual([
      "rebuild",
      "restart-request",
    ]);
  });

  it("closes on 410 and drops the outbox", async () => {
    let postCount = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(empty());
      postCount += 1;
      return Promise.resolve(
        new Response("{}", { status: postCount === 1 ? 201 : 410 }),
      );
    });
    const { result } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "one" });
    result.current.send({ kind: "restart-request", from: "two" });
    await settle();
    expect(result.current.status).toBe("closed");
    expect(sentMessages()).toHaveLength(1);
  });

  it("drops only a message rejected with 400", async () => {
    let sendCount = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(empty());
      if (sendCount++ === 0) return Promise.resolve(new Response("{}", { status: 201 }));
      return Promise.resolve(new Response("{}", { status: sendCount === 2 ? 400 : 201 }));
    });
    const { result } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "one" });
    result.current.send({ kind: "restart-request", from: "two" });
    await settle();
    expect(sentMessages().map((message) => message.kind)).toEqual([
      "rebuild",
      "restart-request",
    ]);
  });

  it("drops queued older offer, answer, and ICE messages for a newer offer", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(empty());
      if (sentMessages().length === 0) return Promise.resolve(new Response("{}", { status: 201 }));
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    });
    const { result } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "one" });
    result.current.send({ kind: "answer", sdp: "old-answer", from: "one" });
    result.current.send({ kind: "ice", candidate: { candidate: "old-ice" }, from: "one" });
    result.current.send({ kind: "offer", sdp: "new-offer", from: "one" });
    resolveFirst?.(new Response("{}", { status: 201 }));
    await settle();
    expect(sentMessages().map((message) => message.kind)).toEqual(["rebuild", "offer"]);
  });

  it("retries immediately when the window becomes online", async () => {
    let rejectFirst: ((reason: Error) => void) | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(empty());
      if (sentMessages().length === 0) return Promise.resolve(new Response("{}", { status: 201 }));
      if (!rejectFirst) return new Promise((_, reject) => (rejectFirst = reject));
      return Promise.resolve(new Response("{}", { status: 201 }));
    });
    const { result } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "peer" });
    rejectFirst?.(new Error("offline"));
    await settle();
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(sentMessages()).toHaveLength(2);
  });

  it("stops retries after unmount", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(empty()),
    );
    const { result, unmount } = render();
    await settle();
    result.current.send({ kind: "rebuild", from: "peer" });
    await settle();
    unmount();
    await advance(10_000);
    expect(sentMessages()).toHaveLength(1);
  });
});
