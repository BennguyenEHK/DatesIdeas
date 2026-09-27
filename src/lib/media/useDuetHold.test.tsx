import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { DUET_RELEASE_MS, useDuetHold } from "./useDuetHold";
import {
  duetRole,
  offsetForDuet,
  offsetForTurn,
  settledOffset,
  singingTurn,
} from "./singerTurn";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Props = { mine: boolean; theirs: boolean; live: boolean };

function hold(initial: Props) {
  return renderHook((p: Props) => useDuetHold(p.mine, p.theirs, p.live), {
    initialProps: initial,
  });
}

describe("useDuetHold", () => {
  it("passes the detector straight through before anyone has sung together", () => {
    const { result, rerender } = hold({ mine: true, theirs: false, live: true });
    expect(result.current).toEqual({ mine: true, theirs: false });
    rerender({ mine: false, theirs: true, live: true });
    expect(result.current).toEqual({ mine: false, theirs: true });
  });

  it("holds a duet through a breath", () => {
    const { result, rerender } = hold({ mine: true, theirs: true, live: true });
    rerender({ mine: false, theirs: true, live: true });
    act(() => void vi.advanceTimersByTime(DUET_RELEASE_MS - 100));
    expect(result.current).toEqual({ mine: true, theirs: true });

    rerender({ mine: true, theirs: true, live: true });
    act(() => void vi.advanceTimersByTime(DUET_RELEASE_MS));
    expect(result.current).toEqual({ mine: true, theirs: true });
  });

  it("lets a real solo go after either singer has been quiet long enough", () => {
    const { result, rerender } = hold({ mine: true, theirs: true, live: true });
    rerender({ mine: true, theirs: false, live: true });
    act(() => void vi.advanceTimersByTime(DUET_RELEASE_MS));
    expect(result.current).toEqual({ mine: true, theirs: false });
  });

  it("counts from the first singer to fall quiet, not the last", () => {
    const { result, rerender } = hold({ mine: true, theirs: true, live: true });
    rerender({ mine: false, theirs: true, live: true });
    act(() => void vi.advanceTimersByTime(DUET_RELEASE_MS / 2));
    rerender({ mine: false, theirs: false, live: true });
    act(() => void vi.advanceTimersByTime(DUET_RELEASE_MS / 2));
    expect(result.current).toEqual({ mine: false, theirs: false });
  });

  it("lets the duet go when the song stops", () => {
    const { result, rerender } = hold({ mine: true, theirs: true, live: true });
    rerender({ mine: false, theirs: true, live: false });
    expect(result.current).toEqual({ mine: false, theirs: true });
  });

  it("THE FADING BEAT: a duet with breaths moves each side's music at most once", () => {
    // The reproduction. Replayed through the real turn rules with the raw
    // detector, this timeline moved Ben's music 4 times and K's 5 in sixteen
    // seconds -- each a fade and a jump. One step per second; latency from
    // the karaoke report.
    const latency = 340;
    const timeline: Array<[boolean, boolean]> = [
      [true, true], [true, true], [true, true], [true, true],
      [true, true], [false, true], [false, true], [true, true],
      [true, true], [true, false], [true, false], [true, true],
      [true, true], [false, true], [true, true], [true, true],
    ];
    for (const anchor of [true, false]) {
      const side = (b: boolean, k: boolean) =>
        anchor ? { mine: b, theirs: k, live: true } : { mine: k, theirs: b, live: true };
      const { result, rerender } = hold(side(...timeline[0]));
      let offset = 0;
      let moves = 0;
      for (const [b, k] of timeline) {
        rerender(side(b, k));
        const { mine, theirs } = result.current;
        const role = duetRole(mine, theirs, anchor);
        const wanted =
          role === "none"
            ? offsetForTurn(singingTurn(mine, theirs), latency)
            : offsetForDuet(role, latency);
        const next = settledOffset(offset, wanted);
        if (next !== offset) moves += 1;
        offset = next;
        act(() => void vi.advanceTimersByTime(1000));
      }
      expect(moves).toBeLessThanOrEqual(1);
    }
  });
});
