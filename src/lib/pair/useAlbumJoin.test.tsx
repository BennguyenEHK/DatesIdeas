import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerMessage } from "@/lib/rtc/protocol";
import { JOIN_FAILED, JOIN_WAIT_MS, useAlbumJoin } from "./useAlbumJoin";

const HELLO: PeerMessage = { t: "hello", identity: "them", name: "K" };

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(initial: { paired: boolean; known?: boolean; connected?: boolean }) {
  const sent: PeerMessage[] = [];
  const send = vi.fn((message: PeerMessage) => void sent.push(message));
  const onJoined = vi.fn();
  const hook = renderHook(
    (props: { paired: boolean; known: boolean; connected: boolean }) =>
      useAlbumJoin({ ...props, send, onJoined }),
    {
      initialProps: {
        paired: initial.paired,
        known: initial.known ?? true,
        connected: initial.connected ?? true,
      },
    },
  );
  return { hook, sent, onJoined };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("useAlbumJoin", () => {
  it("asks to join on hello when this device is not on the album", async () => {
    const { hook, sent } = setup({ paired: false });
    act(() => hook.result.current.accept(HELLO));
    await waitFor(() => expect(sent).toEqual([{ t: "album-join-request" }]));
    expect(hook.result.current.joining).toBe(true);
  });

  it("asks once per hello, not on every render", async () => {
    const { hook, sent } = setup({ paired: false });
    act(() => hook.result.current.accept(HELLO));
    await waitFor(() => expect(sent).toHaveLength(1));
    hook.rerender({ paired: false, known: true, connected: true });
    await Promise.resolve();
    expect(sent).toHaveLength(1);

    act(() => hook.result.current.accept(HELLO));
    await waitFor(() => expect(sent).toHaveLength(2));
  });

  it("does not ask when this device is already on the album", async () => {
    const { hook, sent } = setup({ paired: true });
    act(() => hook.result.current.accept(HELLO));
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(hook.result.current.joining).toBe(false);
  });

  it("waits for the pairing answer before asking", async () => {
    const { hook, sent } = setup({ paired: false, known: false });
    act(() => hook.result.current.accept(HELLO));
    await Promise.resolve();
    expect(sent).toEqual([]);

    hook.rerender({ paired: false, known: true, connected: true });
    await waitFor(() => expect(sent).toEqual([{ t: "album-join-request" }]));
  });

  it("does not ask over a connection that has dropped", async () => {
    const { hook, sent } = setup({ paired: false, connected: false });
    act(() => hook.result.current.accept(HELLO));
    await Promise.resolve();
    expect(sent).toEqual([]);
  });

  it("invites on request only when paired, one invitation at a time", async () => {
    let finish: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    const { hook, sent } = setup({ paired: true });

    act(() => hook.result.current.accept({ t: "album-join-request" }));
    act(() => hook.result.current.accept({ t: "album-join-request" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pair/invite",
      expect.objectContaining({ method: "POST" }),
    );

    await act(async () => finish(json(200, { code: "invite-code", expiresAt: 1234 })));
    await waitFor(() =>
      expect(sent).toEqual([{ t: "album-join", code: "invite-code", expiresAt: 1234 }]),
    );
  });

  it("ignores a request when this device is not on the album either", async () => {
    const { hook, sent } = setup({ paired: false });
    act(() => hook.result.current.accept({ t: "album-join-request" }));
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("redeems an invitation, reloads, and tells the inviting screen", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { paired: true, keyId: "key-2" }));
    const { hook, sent, onJoined } = setup({ paired: false });

    act(() => hook.result.current.accept({ t: "album-join", code: "invite-code", expiresAt: 1 }));
    expect(hook.result.current.joining).toBe(true);

    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pair/claim",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "invite-code" }) }),
    );
    expect(sent).toEqual([{ t: "album-joined", keyId: "key-2" }]);
    expect(hook.result.current.joining).toBe(false);
    expect(hook.result.current.error).toBeNull();
  });

  it("does not redeem an invitation when already on the album", async () => {
    const { hook } = setup({ paired: true });
    act(() => hook.result.current.accept({ t: "album-join", code: "invite-code", expiresAt: 1 }));
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says why a refused invitation failed, and Try again asks afresh", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: "unauthorized" }));
    const { hook, sent, onJoined } = setup({ paired: false });

    act(() => hook.result.current.accept({ t: "album-join", code: "stale", expiresAt: 1 }));
    await waitFor(() => expect(hook.result.current.error).toBe(JOIN_FAILED));
    expect(hook.result.current.joining).toBe(false);
    expect(onJoined).not.toHaveBeenCalled();
    expect(sent).toEqual([]);

    act(() => hook.result.current.retry());
    expect(sent).toEqual([{ t: "album-join-request" }]);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.joining).toBe(true);
  });

  it("stops saying it is getting in when nobody answers", async () => {
    vi.useFakeTimers();
    const { hook } = setup({ paired: false });
    act(() => hook.result.current.retry());
    expect(hook.result.current.joining).toBe(true);

    act(() => vi.advanceTimersByTime(JOIN_WAIT_MS));
    expect(hook.result.current.joining).toBe(false);
    expect(hook.result.current.unanswered).toBe(true);
  });

  it("shows the device that joined, and Undo revokes its key", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { revoked: true }));
    const { hook, sent } = setup({ paired: true });

    act(() => hook.result.current.accept({ t: "album-joined", keyId: "key-2" }));
    expect(hook.result.current.joinedKeyId).toBe("key-2");

    await act(() => hook.result.current.undoJoined());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pair/revoke",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ keyId: "key-2" }) }),
    );
    expect(hook.result.current.joinedKeyId).toBeNull();
    // The revoked device finds out from the server, not from this screen.
    expect(sent).toEqual([]);
  });

  it("keeps the line up when Undo fails", async () => {
    fetchMock.mockResolvedValueOnce(json(404, {}));
    const { hook } = setup({ paired: true });
    act(() => hook.result.current.accept({ t: "album-joined", keyId: "key-2" }));
    await act(() => hook.result.current.undoJoined());
    expect(hook.result.current.joinedKeyId).toBe("key-2");

    act(() => hook.result.current.dismissJoined());
    expect(hook.result.current.joinedKeyId).toBeNull();
  });
});
