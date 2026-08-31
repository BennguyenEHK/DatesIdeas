import { describe, it, expect } from "vitest";
import {
  detectRaw,
  GestureTracker,
  HOLD_MS,
  COOLDOWN_MS,
} from "./gestures";
import type { HandSummary, VisionFrame } from "./types";

function hand(over: Partial<HandSummary> = {}): HandSummary {
  return {
    handedness: "Right",
    extended: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    thumbTip: { x: 0.5, y: 0.5 },
    indexTip: { x: 0.5, y: 0.4 },
    wrist: { x: 0.5, y: 0.7 },
    scale: 0.1,
    ...over,
  };
}

function frame(over: Partial<VisionFrame> = {}): VisionFrame {
  return { timestamp: 0, smileScore: 0, hands: [], ...over };
}

const none = new Set<never>();

describe("detectRaw", () => {
  it("detects peace: index and middle extended, ring and pinky curled", () => {
    const f = frame({
      hands: [hand({ extended: { thumb: false, index: true, middle: true, ring: false, pinky: false } })],
    });
    expect(detectRaw(f, none).has("peace")).toBe(true);
  });

  it("does not detect peace when the ring finger is also extended", () => {
    const f = frame({
      hands: [hand({ extended: { thumb: false, index: true, middle: true, ring: true, pinky: false } })],
    });
    expect(detectRaw(f, none).has("peace")).toBe(false);
  });

  it("detects thumbsUp only when the thumb points up", () => {
    const up = frame({
      hands: [hand({
        extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
        thumbTip: { x: 0.5, y: 0.3 },
        wrist: { x: 0.5, y: 0.7 },
      })],
    });
    expect(detectRaw(up, none).has("thumbsUp")).toBe(true);

    const down = frame({
      hands: [hand({
        extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
        thumbTip: { x: 0.5, y: 0.9 },
        wrist: { x: 0.5, y: 0.7 },
      })],
    });
    expect(detectRaw(down, none).has("thumbsUp")).toBe(false);
  });

  it("detects a smile above threshold", () => {
    expect(detectRaw(frame({ smileScore: 0.8 }), none).has("smile")).toBe(true);
    expect(detectRaw(frame({ smileScore: 0.2 }), none).has("smile")).toBe(false);
  });

  it("detects heart when two hands bring thumb and index tips together", () => {
    const f = frame({
      hands: [
        hand({ handedness: "Left", thumbTip: { x: 0.48, y: 0.5 }, indexTip: { x: 0.49, y: 0.42 } }),
        hand({ handedness: "Right", thumbTip: { x: 0.50, y: 0.5 }, indexTip: { x: 0.51, y: 0.42 } }),
      ],
    });
    expect(detectRaw(f, none).has("heart")).toBe(true);
  });

  it("does not detect heart with hands far apart", () => {
    const f = frame({
      hands: [
        hand({ handedness: "Left", thumbTip: { x: 0.1, y: 0.5 }, indexTip: { x: 0.1, y: 0.4 } }),
        hand({ handedness: "Right", thumbTip: { x: 0.9, y: 0.5 }, indexTip: { x: 0.9, y: 0.4 } }),
      ],
    });
    expect(detectRaw(f, none).has("heart")).toBe(false);
  });

  it("does not detect heart with only one hand", () => {
    expect(detectRaw(frame({ hands: [hand()] }), none).has("heart")).toBe(false);
  });

  it("applies a looser threshold to an already-active gesture (hysteresis)", () => {
    // Just past the enter threshold for smile, but inside the exit threshold.
    const borderline = frame({ smileScore: 0.45 });
    expect(detectRaw(borderline, none).has("smile")).toBe(false);
    expect(detectRaw(borderline, new Set(["smile"] as const)).has("smile")).toBe(true);
  });
});

describe("GestureTracker", () => {
  const smiling = (t: number) => frame({ timestamp: t, smileScore: 0.9 });
  const neutral = (t: number) => frame({ timestamp: t, smileScore: 0.0 });

  it("does not fire before the hold time elapses", () => {
    const g = new GestureTracker();
    expect(g.update(smiling(0))).toEqual([]);
    expect(g.update(smiling(HOLD_MS - 1))).toEqual([]);
  });

  it("fires once the gesture has been held long enough", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);
  });

  it("fires only once per continuous hold", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);
    expect(g.update(smiling(HOLD_MS + 100))).toEqual([]);
    expect(g.update(smiling(HOLD_MS + 500))).toEqual([]);
  });

  it("does not re-fire within the cooldown window", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);
    g.update(neutral(HOLD_MS + 10));
    g.update(smiling(HOLD_MS + 20));
    expect(g.update(smiling(HOLD_MS + 20 + HOLD_MS))).toEqual([]);
  });

  it("fires again after the cooldown has expired", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    expect(g.update(smiling(HOLD_MS))).toEqual(["smile"]);

    const later = HOLD_MS + COOLDOWN_MS + 10;
    g.update(neutral(later - 1));
    g.update(smiling(later));
    expect(g.update(smiling(later + HOLD_MS))).toEqual(["smile"]);
  });

  it("resets the hold timer when the gesture lapses", () => {
    const g = new GestureTracker();
    g.update(smiling(0));
    g.update(neutral(100));
    g.update(smiling(150));
    expect(g.update(smiling(150 + HOLD_MS - 1))).toEqual([]);
    expect(g.update(smiling(150 + HOLD_MS))).toEqual(["smile"]);
  });

  it("tracks gestures independently", () => {
    const g = new GestureTracker();
    const both = (t: number) =>
      frame({
        timestamp: t,
        smileScore: 0.9,
        hands: [hand({ extended: { thumb: false, index: true, middle: true, ring: false, pinky: false } })],
      });
    g.update(both(0));
    expect(g.update(both(HOLD_MS)).sort()).toEqual(["peace", "smile"]);
  });
});
