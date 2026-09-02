import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSignaling } from "./useSignaling";

/**
 * A room lasts a day. When it is over, signalling answers 410 Gone, and the
 * page has to say so — otherwise a stale link looks exactly like a partner who
 * has not arrived yet, and you sit watching "waiting" forever.
 */
const handlers = {
  onPeer: () => {},
  onOffer: () => {},
  onAnswer: () => {},
  onIce: () => {},
};

const gone = () =>
  new Response(JSON.stringify({ error: "this room has closed" }), {
    status: 410,
  });

const empty = () =>
  new Response(JSON.stringify({ signals: [], cursor: 0 }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const render = () =>
  renderHook(() => useSignaling("ABCDEF", handlers, false, true));

describe("a room that has closed", () => {
  it("reports closed when the join is refused", async () => {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === "POST" ? gone() : empty()),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("closed"));
  });

  it("stops polling once the room is closed", async () => {
    // Nothing can arrive in a room no one can post to. Polling on is a request
    // every 500ms, forever, on a tab someone may leave open.
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === "POST" ? gone() : empty()),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("closed"));
    const settled = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(fetchMock.mock.calls.length).toBe(settled);
  });

  it("does not call a working room closed", async () => {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === "POST" ? new Response("{}", { status: 201 }) : empty()),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("waiting"));
    expect(result.current.status).not.toBe("closed");
  });

  it("does not call a network failure closed", async () => {
    // Offline is not expired. Saying "this evening has ended" to someone whose
    // wifi dropped sends them off to make a new room for no reason.
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.status).not.toBe("closed");
  });

  it("notices a room that closes underneath a handshake", async () => {
    // Joined at 23:59:59, sent an ICE candidate at 00:00:01.
    let first = true;
    fetchMock.mockImplementation((_url, init) => {
      if (init?.method !== "POST") return Promise.resolve(empty());
      if (first) {
        first = false;
        return Promise.resolve(new Response("{}", { status: 201 }));
      }
      return Promise.resolve(gone());
    });
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("waiting"));
    result.current.send({
      kind: "ice",
      candidate: { candidate: "x" },
      from: "11111111-2222-4333-8444-555555555555",
    });
    await waitFor(() => expect(result.current.status).toBe("closed"));
  });
});
