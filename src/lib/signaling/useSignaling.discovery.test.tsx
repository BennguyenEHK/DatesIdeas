import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSignaling, type PeerInfo } from "./useSignaling";

/**
 * Regression tests for the room where nobody arrives.
 *
 * The realistic shape of an evening: one person opens the room and waits, the
 * other joins minutes later. A join was announced exactly once and discarded
 * after two minutes, so the person who had been waiting patiently was read as
 * debris from a previous sitting — and the row backing it is swept from the
 * table after fifteen. Between those two facts, a peer whose laptop had slept
 * had nothing left to find, and neither side ever offered while both sat in
 * the room looking at the other's absence.
 */

let fetchMock: ReturnType<typeof vi.fn>;
let peers: Array<{ them: PeerInfo; iOffer: boolean }>;

/**
 * A fetch that answers a POST with an empty ack and every poll with one join
 * from somebody else. Built per call, because a Response body can only be read
 * once and the poll loop reads one on every tick.
 */
function fetchReturning(join: { joinedAt: number; sentAt?: number } | null) {
  return vi.fn((_url: string, init?: RequestInit) => {
    const signals =
      init?.method === "POST" || join === null
        ? []
        : [
            {
              kind: "join",
              identity: "them-0000",
              joinedAt: join.joinedAt,
              ...(join.sentAt === undefined ? {} : { sentAt: join.sentAt }),
            },
          ];
    return Promise.resolve(
      new Response(JSON.stringify({ signals, cursor: signals.length }), {
        status: 200,
      }),
    );
  });
}

const handlers = () => ({
  onPeer: (them: PeerInfo, iOffer: boolean) => void peers.push({ them, iOffer }),
  onOffer: () => {},
  onAnswer: () => {},
  onIce: () => {},
});

const joins = () =>
  fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes("/api/signal") && c[1]?.method === "POST",
  );

beforeEach(() => {
  localStorage.clear();
  peers = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("finding someone who was already in the room", () => {
  it("pairs with a peer who has been waiting for minutes", async () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    fetchMock = fetchReturning({ joinedAt: fiveMinutesAgo, sentAt: Date.now() });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSignaling("ABCDEF", handlers(), false, true));

    await waitFor(() => expect(peers).toHaveLength(1));
    // They arrived first, so they offer and we answer.
    expect(peers[0].iOffer).toBe(false);
    expect(peers[0].them.joinedAt).toBe(fiveMinutesAgo);
  });

  it("still ignores a genuinely abandoned join from an earlier sitting", async () => {
    const longAgo = Date.now() - 30 * 60 * 1000;
    fetchMock = fetchReturning({ joinedAt: longAgo, sentAt: longAgo });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSignaling("ABCDEF", handlers(), false, true));

    await new Promise((r) => setTimeout(r, 300));
    expect(peers).toHaveLength(0);
  });

  /**
   * An older build sends no sentAt at all. Falling back to joinedAt keeps the
   * previous behaviour rather than pairing with anything at all.
   */
  it("falls back to the arrival time when a peer sends no sentAt", async () => {
    const longAgo = Date.now() - 30 * 60 * 1000;
    fetchMock = fetchReturning({ joinedAt: longAgo });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSignaling("ABCDEF", handlers(), false, true));

    await new Promise((r) => setTimeout(r, 300));
    expect(peers).toHaveLength(0);
  });

  it("pairs immediately with a peer who just arrived", async () => {
    const now = Date.now();
    fetchMock = fetchReturning({ joinedAt: now + 5_000, sentAt: now });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSignaling("ABCDEF", handlers(), false, true));

    await waitFor(() => expect(peers).toHaveLength(1));
    // We arrived first this time, so the offer is ours to make.
    expect(peers[0].iOffer).toBe(true);
  });

  it("only ever reports a peer once, however often they re-announce", async () => {
    fetchMock = fetchReturning({ joinedAt: Date.now() - 1000, sentAt: Date.now() });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSignaling("ABCDEF", handlers(), false, true));

    await waitFor(() => expect(peers).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 400));
    expect(peers).toHaveLength(1);
  });

  it("carries a sentAt on the announcement so the other side can judge it", async () => {
    fetchMock = fetchReturning(null);
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSignaling("ABCDEF", handlers(), false, true));

    await waitFor(() => expect(joins().length).toBeGreaterThan(0));
    const body = JSON.parse(String(joins()[0][1].body));
    expect(body.payload.sentAt).toBeGreaterThan(0);
    expect(body.payload.joinedAt).toBeGreaterThan(0);
  });
});
