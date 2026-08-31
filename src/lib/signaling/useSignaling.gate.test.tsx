import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSignaling } from "./useSignaling";

/**
 * Regression test for the one-way video bug.
 *
 * A peer must not announce itself until it knows what it can send. Announcing
 * early lets the other side offer immediately, and the offer is then answered
 * before getUserMedia has resolved — so the answerer negotiates `recvonly`
 * transceivers and can never send video, even once its camera appears. The
 * symptom is asymmetric: the answerer sees both streams (its own preview plus
 * the offerer's track) while the offerer sees only itself.
 */

const handlers = {
  onPeer: () => {},
  onOffer: () => {},
  onAnswer: () => {},
  onIce: () => {},
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ signals: [], cursor: 0 }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const calls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const joins = () =>
  fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes("/api/signal") && c[1]?.method === "POST",
  );

describe("useSignaling media gate", () => {
  it("makes no requests at all while media has not settled", async () => {
    renderHook(() => useSignaling("ABCDEF", handlers, false, false));
    // Give any stray effect a chance to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls()).toEqual([]);
  });

  it("does not announce a join before media settles", async () => {
    renderHook(() => useSignaling("ABCDEF", handlers, false, false));
    await new Promise((r) => setTimeout(r, 50));
    expect(joins()).toHaveLength(0);
  });

  it("announces the join once media has settled", async () => {
    renderHook(() => useSignaling("ABCDEF", handlers, false, true));
    await waitFor(() => expect(joins().length).toBeGreaterThan(0));
    const body = JSON.parse(String(joins()[0][1].body));
    expect(body.payload.kind).toBe("join");
    expect(body.code).toBe("ABCDEF");
  });

  it("starts polling only after media settles", async () => {
    const { rerender } = renderHook(
      ({ ready }) => useSignaling("ABCDEF", handlers, false, ready),
      { initialProps: { ready: false } },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(calls().some((u) => u.includes("after="))).toBe(false);

    rerender({ ready: true });
    await waitFor(() =>
      expect(calls().some((u) => u.includes("after="))).toBe(true),
    );
  });
});
