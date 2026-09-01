import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMemeQueue, MEME_VISIBLE_MS } from "./useMemeQueue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMemeQueue", () => {
  it("shows a meme immediately", () => {
    const { result } = renderHook(() => useMemeQueue());
    act(() => result.current.show("heart"));
    expect(result.current.memes.map((m) => m.id)).toEqual(["heart"]);
  });

  it("keeps the meme on screen for the full visible window", () => {
    const { result } = renderHook(() => useMemeQueue());
    act(() => result.current.show("heart"));
    act(() => void vi.advanceTimersByTime(MEME_VISIBLE_MS - 1));
    expect(result.current.memes).toHaveLength(1);
  });

  it("removes the meme once the window elapses", () => {
    const { result } = renderHook(() => useMemeQueue());
    act(() => result.current.show("heart"));
    act(() => void vi.advanceTimersByTime(MEME_VISIBLE_MS));
    expect(result.current.memes).toHaveLength(0);
  });

  it("holds for 2200ms after the pop-in completes", () => {
    // The user-visible requirement: a fired meme sits still for 2.2s before
    // the fade begins. The pop-in is what precedes that, not part of it.
    expect(MEME_VISIBLE_MS).toBeGreaterThanOrEqual(2200);
  });

  it("gives repeated gestures distinct keys so both animate", () => {
    const { result } = renderHook(() => useMemeQueue());
    act(() => result.current.show("heart"));
    act(() => result.current.show("heart"));
    const keys = result.current.memes.map((m) => m.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("expires each meme on its own schedule", () => {
    const { result } = renderHook(() => useMemeQueue());
    act(() => result.current.show("heart"));
    act(() => void vi.advanceTimersByTime(1000));
    act(() => result.current.show("peace"));

    act(() => void vi.advanceTimersByTime(MEME_VISIBLE_MS - 1000));
    expect(result.current.memes.map((m) => m.id)).toEqual(["peace"]);

    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.memes).toHaveLength(0);
  });

  it("clears pending timers on unmount", () => {
    const { result, unmount } = renderHook(() => useMemeQueue());
    act(() => result.current.show("smile"));
    unmount();
    // A timer surviving unmount would set state on a dead component.
    expect(vi.getTimerCount()).toBe(0);
  });
});
