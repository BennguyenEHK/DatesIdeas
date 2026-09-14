import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCreateSpace } from "./useCreateSpace";
import type { Stroke } from "./ops";
import type { PeerMessage } from "@/lib/rtc/protocol";

function stroke(id: string, author: string, at: number): Stroke {
  return { id, author, at, ink: "#e8b94a", width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] };
}

describe("useCreateSpace", () => {
  it("applies a local edit here and sends the same operation", () => {
    const send = vi.fn();
    const { result } = renderHook(() => useCreateSpace({ send }));

    act(() => result.current.apply({ kind: "stroke", stroke: stroke("a", "ben", 1) }));

    expect(result.current.scene.items.map((item) => item.id)).toEqual(["a"]);
    expect(send).toHaveBeenCalledWith({ t: "canvas", op: { kind: "stroke", stroke: stroke("a", "ben", 1) } });
  });

  it("applies the other person's edit without echoing it back", () => {
    // Echoing received edits would bounce every stroke back and forth forever.
    const send = vi.fn();
    const { result } = renderHook(() => useCreateSpace({ send }));

    act(() => result.current.accept({ t: "canvas", op: { kind: "stroke", stroke: stroke("b", "k", 2) } }));

    expect(result.current.scene.items.map((item) => item.id)).toEqual(["b"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("ends with the same picture on both screens whichever order edits cross in", () => {
    const wire: PeerMessage[] = [];
    const ben = renderHook(() => useCreateSpace({ send: (m) => wire.push(m) }));
    const k = renderHook(() => useCreateSpace({ send: () => {} }));

    act(() => ben.result.current.apply({ kind: "stroke", stroke: stroke("mine", "ben", 10) }));
    act(() => k.result.current.apply({ kind: "stroke", stroke: stroke("theirs", "k", 5) }));
    // K's stroke reaches Ben, Ben's reaches K, in opposite orders.
    act(() => ben.result.current.accept({ t: "canvas", op: { kind: "stroke", stroke: stroke("theirs", "k", 5) } }));
    for (const message of wire) act(() => k.result.current.accept(message));

    expect(ben.result.current.scene).toEqual(k.result.current.scene);
  });

  it("follows the other person's choice of picture", () => {
    const { result } = renderHook(() => useCreateSpace({ send: vi.fn() }));
    act(() => result.current.accept({ t: "canvas-base", itemId: "photo-1" }));
    expect(result.current.baseItemId).toBe("photo-1");
  });

  it("replays the whole picture to somebody who has just rejoined", () => {
    const send = vi.fn();
    const { result } = renderHook(() => useCreateSpace({ send }));
    act(() => result.current.setBase("photo-1"));
    act(() => result.current.apply({ kind: "stroke", stroke: stroke("a", "ben", 1) }));
    act(() =>
      result.current.apply({
        kind: "sticker",
        sticker: { id: "s", author: "ben", at: 2, glyph: "❤️", x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      }),
    );
    send.mockClear();

    act(() => result.current.resync());

    const late = renderHook(() => useCreateSpace({ send: vi.fn() }));
    for (const [message] of send.mock.calls) act(() => late.result.current.accept(message as PeerMessage));
    expect(late.result.current.scene).toEqual(result.current.scene);
    expect(late.result.current.baseItemId).toBe("photo-1");
  });

  it("undoes and redoes only this person's mark", () => {
    const send = vi.fn();
    const { result } = renderHook(() => useCreateSpace({ send, identity: "ben" }));
    act(() => result.current.apply({ kind: "stroke", stroke: stroke("a", "ben", 1) }));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    expect(result.current.scene.items).toEqual([]);
    act(() => result.current.redo());
    expect(result.current.scene.items).toHaveLength(1);
    expect(result.current.scene.items[0]).toMatchObject({ author: "ben", at: 1 });
  });

  it("converges when the other screen receives an undo and its redo in reverse order", () => {
    const send = vi.fn();
    const { result } = renderHook(() => useCreateSpace({ send, identity: "ben" }));
    act(() => result.current.apply({ kind: "stroke", stroke: stroke("a", "ben", 1) }));
    act(() => result.current.undo());
    act(() => result.current.redo());

    const messages = send.mock.calls.map(([message]) => message as PeerMessage);
    const [add, remove, readd] = messages;
    const other = renderHook(() => useCreateSpace({ send: vi.fn(), identity: "k" }));
    for (const message of [add, readd, remove]) act(() => other.result.current.accept(message));

    expect(other.result.current.scene).toEqual(result.current.scene);
  });

  it("shares newer sessions and finishes an incoming nonce once", () => {
    const send = vi.fn();
    const onFinish = vi.fn();
    const { result } = renderHook(() => useCreateSpace({ send, identity: "ben", now: () => 42, onFinish }));
    act(() => result.current.setSession({ workshop: "strip", shots: 2 }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      t: "canvas-session", session: expect.objectContaining({ workshop: "strip", shots: 2, at: 42, by: "ben" }),
    }));
    act(() => result.current.accept({ t: "canvas-finish", nonce: "once" }));
    act(() => result.current.accept({ t: "canvas-finish", nonce: "once" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
