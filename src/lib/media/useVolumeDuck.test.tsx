import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVolumeDuck } from "./useVolumeDuck";
import { duckTotalMs, duckSilentAtMs } from "./duck";
import type { PlayerHandle } from "./player";

/** Records the volumes a dip asks for, in order. */
function fakePlayer(ready = true) {
  const volumes: number[] = [];
  const handle: PlayerHandle = {
    isReady: () => ready,
    load: () => {},
    play: () => {},
    pause: () => {},
    seek: () => {},
    nudge: () => {},
    setRate: () => false,
    currentTime: () => 0,
    setVolume: (v) => volumes.push(v),
  };
  return { handle, volumes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useVolumeDuck", () => {
  it("applies the change in the middle of the silence, not at the start", () => {
    const { handle, volumes } = fakePlayer();
    const { result } = renderHook(() => useVolumeDuck(handle, 70));
    const apply = vi.fn();

    act(() => result.current(apply));
    // The whole point: the seek must not happen while the music is audible.
    expect(apply).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(duckSilentAtMs()));
    expect(apply).toHaveBeenCalledTimes(1);
    // And by then the music is genuinely silent, so the seek has cover.
    expect(volumes.at(-1)).toBe(0);
  });

  it("restores the original volume exactly when the dip ends", () => {
    const { handle, volumes } = fakePlayer();
    const { result } = renderHook(() => useVolumeDuck(handle, 70));

    act(() => result.current(() => {}));
    act(() => void vi.advanceTimersByTime(duckTotalMs() + 10));

    expect(volumes.at(-1)).toBe(70);
  });

  it("passes through untouched when there is no player to fade", () => {
    const { result } = renderHook(() => useVolumeDuck(null, 70));
    const apply = vi.fn();

    act(() => result.current(apply));

    // Immediately, not after two thirds of a second: there is no lurch to
    // hide, so nothing should be made to wait for one.
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("passes through untouched when the player is not ready yet", () => {
    const { handle, volumes } = fakePlayer(false);
    const { result } = renderHook(() => useVolumeDuck(handle, 70));
    const apply = vi.fn();

    act(() => result.current(apply));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(volumes).toEqual([]);
  });

  /**
   * Two turns changing hands in quick succession. If the first dip's fade-in
   * survived alongside the second dip's fade-out they would fight for the
   * volume, and the music could be left quiet for the rest of the song.
   */
  it("abandons a dip already in progress rather than overlapping two", () => {
    const { handle, volumes } = fakePlayer();
    const { result } = renderHook(() => useVolumeDuck(handle, 70));
    const first = vi.fn();
    const second = vi.fn();

    act(() => result.current(first));
    act(() => void vi.advanceTimersByTime(60));
    act(() => result.current(second));
    act(() => void vi.advanceTimersByTime(duckTotalMs() + 10));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(volumes.at(-1)).toBe(70);
  });

  it("lands on the volume as it is when the dip ends, not as it began", () => {
    const { handle, volumes } = fakePlayer();
    const { result, rerender } = renderHook(
      ({ volume }) => useVolumeDuck(handle, volume),
      { initialProps: { volume: 70 } },
    );

    act(() => result.current(() => {}));
    // Someone turns the music up while it is dipped.
    rerender({ volume: 100 });
    act(() => void vi.advanceTimersByTime(duckTotalMs() + 10));

    expect(volumes.at(-1)).toBe(100);
  });

  it("never leaves the music quiet after unmounting mid-dip", () => {
    const { handle, volumes } = fakePlayer();
    const { result, unmount } = renderHook(() => useVolumeDuck(handle, 70));

    act(() => result.current(() => {}));
    act(() => void vi.advanceTimersByTime(60));
    const during = volumes.length;
    unmount();
    act(() => void vi.advanceTimersByTime(duckTotalMs() + 10));

    // Nothing fires after unmount — no setVolume on a torn-down player, and
    // no apply() reaching into a component that is gone.
    expect(volumes.length).toBe(during);
  });
});
