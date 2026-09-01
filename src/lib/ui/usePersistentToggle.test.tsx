import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistentToggle } from "./usePersistentToggle";

/** A key of its own per test: the hook keeps module-level state by design. */
let n = 0;
const freshKey = () => `datesidea.test.toggle.${n++}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePersistentToggle", () => {
  it("uses the fallback when nothing is stored", () => {
    const key = freshKey();
    const { result } = renderHook(() => usePersistentToggle(key, true));
    expect(result.current[0]).toBe(true);
  });

  it("honours a fallback of false", () => {
    const key = freshKey();
    const { result } = renderHook(() => usePersistentToggle(key, false));
    expect(result.current[0]).toBe(false);
  });

  it("flips the value", () => {
    const key = freshKey();
    const { result } = renderHook(() => usePersistentToggle(key, true));
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it("survives a remount", () => {
    const key = freshKey();
    const first = renderHook(() => usePersistentToggle(key, true));
    act(() => first.result.current[1](false));
    first.unmount();

    const second = renderHook(() => usePersistentToggle(key, true));
    // The stored `false` must beat the `true` fallback, or the switch silently
    // re-arms itself on every refresh.
    expect(second.result.current[0]).toBe(false);
  });

  it("keeps other keys independent", () => {
    // One person's switch must never move anything else, least of all the
    // other person's — which is why this state is device-local, not shared.
    const keyA = freshKey();
    const keyB = freshKey();
    const a = renderHook(() => usePersistentToggle(keyA, true));
    const b = renderHook(() => usePersistentToggle(keyB, true));
    act(() => a.result.current[1](false));
    expect(b.result.current[0]).toBe(true);
    expect(a.result.current[0]).toBe(false);
  });

  it("falls back when localStorage reads throw", () => {
    // Safari private browsing and hardened privacy settings both do this.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const key = freshKey();
    const { result } = renderHook(() => usePersistentToggle(key, true));
    expect(result.current[0]).toBe(true);
  });

  it("still toggles in memory when localStorage writes throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const key = freshKey();
    const { result } = renderHook(() => usePersistentToggle(key, true));
    act(() => result.current[1](false));
    // The choice must take effect for this session even if it cannot persist.
    expect(result.current[0]).toBe(false);
  });
});
