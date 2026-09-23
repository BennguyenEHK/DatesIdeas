import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { POLL_IDLE_MS, POLL_PAIRING_MS, useSignaling } from "./useSignaling";

/**
 * An ICE restart is a handshake like the first one, and it used to be carried
 * at the paired heartbeat rate: the answer and every trickled candidate each
 * waited up to five seconds, so a restart took ten to twenty seconds of a
 * frozen call. While recovering, signalling must run at the pairing rate.
 */

const handlers = {
  onPeer: () => {},
  onOffer: () => {},
  onAnswer: () => {},
  onIce: () => {},
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ signals: [], cursor: 0 }), { status: 200 }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const polls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/signal?"))
    .length;

/** Lets the first poll and announce settle before counting from a clean slate. */
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

describe("useSignaling poll rate while a paired call recovers", () => {
  it("polls at the heartbeat rate once paired and healthy", async () => {
    renderHook(() => useSignaling("ABCDEF", handlers, true, true, false));
    await settle();
    const before = polls();
    await advance(POLL_IDLE_MS * 2);
    expect(polls() - before).toBe(2);
  });

  it("polls every 500 ms while recovering, even though paired", async () => {
    renderHook(() => useSignaling("ABCDEF", handlers, true, true, true));
    await settle();
    const before = polls();
    await advance(POLL_PAIRING_MS * 10);
    expect(POLL_PAIRING_MS).toBe(500);
    expect(polls() - before).toBe(10);
  });

  it("wakes a sleeping heartbeat the moment recovery begins", async () => {
    const { rerender } = renderHook(
      ({ recovering }) =>
        useSignaling("ABCDEF", handlers, true, true, recovering),
      { initialProps: { recovering: false } },
    );
    await settle();
    const before = polls();
    rerender({ recovering: true });
    await advance(0);
    // Polled immediately rather than after the remaining five-second wait.
    expect(polls() - before).toBe(1);
    await advance(POLL_PAIRING_MS * 4);
    expect(polls() - before).toBe(5);
  });

  it("returns to the heartbeat rate once the call is back", async () => {
    const { rerender } = renderHook(
      ({ recovering }) =>
        useSignaling("ABCDEF", handlers, true, true, recovering),
      { initialProps: { recovering: true } },
    );
    await settle();
    rerender({ recovering: false });
    // Let the one fast poll already scheduled fire and reschedule slowly.
    await advance(POLL_PAIRING_MS);
    const before = polls();
    await advance(POLL_IDLE_MS * 2);
    expect(polls() - before).toBe(2);
  });
});
