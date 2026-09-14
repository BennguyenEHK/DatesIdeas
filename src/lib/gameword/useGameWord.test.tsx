import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGameWord } from "./useGameWord";

describe("useGameWord web games", () => {
  it("uses sentAt ordering and the larger id on ties", () => {
    const send = vi.fn();
    const hook = renderHook(() =>
      useGameWord({ identity: "me", partnerIdentity: "them", send, now: () => 10 }),
    );
    act(() => hook.result.current.accept({ t: "webgame", id: "lichess", sentAt: 20 }));
    act(() => hook.result.current.accept({ t: "webgame", id: "skribbl", sentAt: 19 }));
    expect(hook.result.current.webGame).toBe("lichess");
    act(() => hook.result.current.accept({ t: "webgame", id: "skribbl", sentAt: 20 }));
    expect(hook.result.current.webGame).toBe("skribbl");
    act(() => hook.result.current.accept({ t: "webgame", id: "skribbl", sentAt: 20 }));
    expect(hook.result.current.webGame).toBe("skribbl");
    act(() => hook.result.current.openWebGame(null));
    expect(send).toHaveBeenLastCalledWith({ t: "webgame", id: null, sentAt: 10 });
  });

  it("resyncs the latest web game state", () => {
    const send = vi.fn();
    const hook = renderHook(() =>
      useGameWord({ identity: "me", partnerIdentity: "them", send, now: () => 7 }),
    );
    act(() => hook.result.current.openWebGame("papergames"));
    send.mockClear();
    act(() => hook.result.current.resync());
    expect(send).toHaveBeenCalledWith({ t: "webgame", id: "papergames", sentAt: 7 });
  });
});
