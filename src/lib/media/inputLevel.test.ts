import { describe, it, expect } from "vitest";
import {
  CLIP_RMS,
  describeLevel,
  EMPTY_WATCH,
  GATE_FLOOR_RMS,
  LOUD_RMS,
  observeLevel,
  type LevelWatch,
} from "./inputLevel";

/** Feeds a whole phrase through the watcher, in order. */
const watch = (samples: readonly number[]): LevelWatch =>
  samples.reduce(observeLevel, EMPTY_WATCH);

describe("observeLevel", () => {
  it("remembers the loudest moment", () => {
    expect(watch([0.01, 0.4, 0.12]).peak).toBeCloseTo(0.4);
  });

  it("counts nothing while a voice simply rises and falls", () => {
    // An ordinary phrase: quiet, loud, decaying away. Nothing here is a fault
    // and a diagnostic that cried wolf on it would be worse than none.
    expect(watch([0.02, 0.2, 0.3, 0.18, 0.07, 0.03, 0.01]).gates).toBe(0);
  });

  it("counts a collapse from full voice straight to silence", () => {
    // The reported symptom, as it looks in the numbers: someone is clearly
    // singing, and one sample later the microphone is delivering nothing.
    expect(watch([0.02, 0.25, GATE_FLOOR_RMS / 2]).gates).toBe(1);
  });

  it("does not count silence that was already quiet", () => {
    expect(watch([0.02, 0.01, 0.0001]).gates).toBe(0);
  });

  it("counts each separate collapse", () => {
    expect(watch([0.3, 0, 0.3, 0, 0.3, 0]).gates).toBe(3);
  });

  it("notices a signal loud enough to be clipping the input", () => {
    expect(watch([0.2, CLIP_RMS + 0.05]).clips).toBe(1);
    expect(watch([0.2, 0.3]).clips).toBe(0);
  });

  it("ignores a meter reading that is not a number", () => {
    const before = watch([0.3]);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(observeLevel(before, bad)).toEqual(before);
    }
  });

  it("treats the loud threshold as the edge of a real voice", () => {
    // Just under counts as too quiet to call a collapse; just over does not.
    expect(watch([LOUD_RMS - 0.001, 0]).gates).toBe(0);
    expect(watch([LOUD_RMS, 0]).gates).toBe(1);
  });
});

describe("describeLevel", () => {
  it("says nothing was heard when nothing was", () => {
    expect(describeLevel(EMPTY_WATCH)).toBe("no signal yet");
  });

  it("reports a clean run as peak alone", () => {
    expect(describeLevel(watch([0.1, 0.42]))).toBe("peak 0.42");
  });

  it("calls out the dropouts, because they are the whole question", () => {
    expect(describeLevel(watch([0.3, 0, 0.3, 0]))).toBe(
      "peak 0.30, 2 dropouts",
    );
  });

  it("calls out clipping separately from dropouts", () => {
    expect(describeLevel(watch([0.9, 0]))).toBe(
      "peak 0.90, 1 dropout, 1 clipped",
    );
  });
});
