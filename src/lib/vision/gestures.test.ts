import { describe, it, expect } from "vitest";
import {
  detectRaw,
  GestureTracker,
  HOLD_MS,
  COOLDOWN_MS,
  holdFor,
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
  return {
    timestamp: 0,
    smileScore: 0,
    puckerScore: 0,
    blinkLeft: 0,
    blinkRight: 0,
    mouth: null,
    hands: [],
    ...over,
  };
}

/** All four fingers out — a flat palm, as in a prayer. */
const FLAT = { thumb: false, index: true, middle: true, ring: true, pinky: true };

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
    expect(detectRaw(frame({ smileScore: 0.85 }), none).has("smile")).toBe(true);
    expect(detectRaw(frame({ smileScore: 0.2 }), none).has("smile")).toBe(false);
  });

  it("ignores a polite half-smile", () => {
    // A face at rest or being pleasant sits around here. Only a real smile
    // should put an emoji on both screens.
    expect(detectRaw(frame({ smileScore: 0.6 }), none).has("smile")).toBe(false);
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

  it("detects a blown kiss from pursed lips", () => {
    expect(detectRaw(frame({ puckerScore: 0.95 }), none).has("blowKiss")).toBe(true);
    expect(detectRaw(frame({ puckerScore: 0.2 }), none).has("blowKiss")).toBe(false);
  });

  it("does not read a broad smile as a kiss", () => {
    // The two mouth shapes are near opposites; a frame reporting both is
    // ambiguous, and a smile is the far more likely reading.
    const f = frame({ puckerScore: 0.95, smileScore: 0.85 });
    expect(detectRaw(f, none).has("blowKiss")).toBe(false);
    expect(detectRaw(f, none).has("smile")).toBe(true);
  });

  it("detects a wink but never an ordinary blink", () => {
    const wink = frame({ blinkLeft: 0.9, blinkRight: 0.05 });
    expect(detectRaw(wink, none).has("wink")).toBe(true);

    // Both eyes shut. This is the case that must never fire, or the overlay
    // would flash every few seconds all evening.
    const blink = frame({ blinkLeft: 0.9, blinkRight: 0.9 });
    expect(detectRaw(blink, none).has("wink")).toBe(false);

    const open = frame({ blinkLeft: 0.05, blinkRight: 0.05 });
    expect(detectRaw(open, none).has("wink")).toBe(false);
  });

  it("detects a wink with either eye", () => {
    expect(detectRaw(frame({ blinkLeft: 0.05, blinkRight: 0.9 }), none).has("wink")).toBe(
      true,
    );
  });

  it("detects thumbsDown only when the thumb points down", () => {
    const down = frame({
      hands: [hand({
        extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
        thumbTip: { x: 0.5, y: 0.9 },
        wrist: { x: 0.5, y: 0.7 },
      })],
    });
    expect(detectRaw(down, none).has("thumbsDown")).toBe(true);
    expect(detectRaw(down, none).has("thumbsUp")).toBe(false);
  });

  it("detects prayer: two flat palms together, pointing up", () => {
    const f = frame({
      hands: [
        hand({ extended: FLAT, wrist: { x: 0.49, y: 0.70 }, indexTip: { x: 0.49, y: 0.40 } }),
        hand({ extended: FLAT, wrist: { x: 0.51, y: 0.70 }, indexTip: { x: 0.51, y: 0.40 } }),
      ],
    });
    expect(detectRaw(f, none).has("pray")).toBe(true);
  });

  it("does not read flat palms lying down as a prayer", () => {
    // Fingertips below the wrists: hands resting, not raised.
    const f = frame({
      hands: [
        hand({ extended: FLAT, wrist: { x: 0.49, y: 0.4 }, indexTip: { x: 0.49, y: 0.7 } }),
        hand({ extended: FLAT, wrist: { x: 0.51, y: 0.4 }, indexTip: { x: 0.51, y: 0.7 } }),
      ],
    });
    expect(detectRaw(f, none).has("pray")).toBe(false);
  });

  it("tells a prayer from a heart", () => {
    // The collision that made this rule necessary: two palms pressed together
    // put the thumb tips AND index tips together, which is exactly the
    // proximity test for a heart. Only the curled ring and pinky separate them.
    const praying = frame({
      hands: [
        hand({ extended: FLAT, thumbTip: { x: 0.49, y: 0.5 }, indexTip: { x: 0.49, y: 0.4 }, wrist: { x: 0.49, y: 0.7 } }),
        hand({ extended: FLAT, thumbTip: { x: 0.51, y: 0.5 }, indexTip: { x: 0.51, y: 0.4 }, wrist: { x: 0.51, y: 0.7 } }),
      ],
    });
    const got = detectRaw(praying, none);
    expect(got.has("pray")).toBe(true);
    expect(got.has("heart")).toBe(false);
  });

  it("detects a hand raised over the mouth", () => {
    const f = frame({
      mouth: { x: 0.5, y: 0.5 },
      hands: [hand({ wrist: { x: 0.5, y: 0.55 }, indexTip: { x: 0.5, y: 0.48 } })],
    });
    expect(detectRaw(f, none).has("handsOverMouth")).toBe(true);
  });

  it("does not fire for a hand raised somewhere else", () => {
    const f = frame({
      mouth: { x: 0.5, y: 0.5 },
      hands: [hand({ wrist: { x: 0.1, y: 0.9 }, indexTip: { x: 0.1, y: 0.8 } })],
    });
    expect(detectRaw(f, none).has("handsOverMouth")).toBe(false);
  });

  it("reads a hand at the mouth with pursed lips as a kiss, not surprise", () => {
    // Blowing a kiss brings a hand up too. The lips decide which it is.
    const f = frame({
      puckerScore: 0.95,
      mouth: { x: 0.5, y: 0.5 },
      hands: [hand({ wrist: { x: 0.5, y: 0.55 }, indexTip: { x: 0.5, y: 0.48 } })],
    });
    const got = detectRaw(f, none);
    expect(got.has("blowKiss")).toBe(true);
    expect(got.has("handsOverMouth")).toBe(false);
  });

  it("cannot detect a covered mouth with no face", () => {
    const f = frame({
      mouth: null,
      hands: [hand({ wrist: { x: 0.5, y: 0.55 }, indexTip: { x: 0.5, y: 0.48 } })],
    });
    expect(detectRaw(f, none).has("handsOverMouth")).toBe(false);
  });

  it("ignores a mouth merely at rest", () => {
    // 0.7 still fired on a mouth at rest; a kiss now needs a deliberate purse.
    expect(detectRaw(frame({ puckerScore: 0.75 }), none).has("blowKiss")).toBe(false);
  });

  it("detects a wink that does not fully shut the eye", () => {
    // Most people do not squeeze the eye closed. Demanding that they do is
    // what made this the hardest gesture to trigger.
    const soft = frame({ blinkLeft: 0.45, blinkRight: 0.05 });
    expect(detectRaw(soft, none).has("wink")).toBe(true);
  });

  it("does not read a forming heart as two thumbs-down", () => {
    // The reported collision. Index fingers CURVE to make the top of a heart
    // rather than straightening, so they measure as curled -- leaving each
    // hand looking exactly like a thumbs gesture, with the thumbs angled
    // just far enough down to pass the old check.
    const heart = frame({
      hands: [
        hand({
          extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
          thumbTip: { x: 0.49, y: 0.56 }, indexTip: { x: 0.49, y: 0.42 }, wrist: { x: 0.46, y: 0.52 },
        }),
        hand({
          extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
          thumbTip: { x: 0.51, y: 0.56 }, indexTip: { x: 0.51, y: 0.42 }, wrist: { x: 0.54, y: 0.52 },
        }),
      ],
    });
    const got = detectRaw(heart, none);
    expect(got.has("thumbsDown")).toBe(false);
    expect(got.has("thumbsUp")).toBe(false);
    // And it is still read as what it actually is.
    expect(got.has("heart")).toBe(true);
  });

  it("still reads a single clear thumbs-down", () => {
    // One hand, thumb well clear of the wrist. Nothing above may break this.
    const f = frame({
      hands: [hand({
        extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
        thumbTip: { x: 0.5, y: 0.9 }, wrist: { x: 0.5, y: 0.7 },
      })],
    });
    expect(detectRaw(f, none).has("thumbsDown")).toBe(true);
  });

  it("ignores a thumb barely off the wrist", () => {
    // Sitting on the correct side of the wrist is not a thumbs-down; that is
    // how a heart passed the old test.
    const f = frame({
      hands: [hand({
        extended: { thumb: true, index: false, middle: false, ring: false, pinky: false },
        thumbTip: { x: 0.5, y: 0.72 }, wrist: { x: 0.5, y: 0.7 }, scale: 0.1,
      })],
    });
    expect(detectRaw(f, none).has("thumbsDown")).toBe(false);
  });

  it("does not read a wink as a smile", () => {
    // The reported bug. Closing one eye raises that cheek, and the smile
    // blendshape keys off cheek raise, so a real wink arrives with a high
    // smile score attached. The eyes have to settle it.
    const f = frame({ blinkLeft: 0.9, blinkRight: 0.05, smileScore: 0.85 });
    const got = detectRaw(f, none);
    expect(got.has("wink")).toBe(true);
    expect(got.has("smile")).toBe(false);
  });

  it("does not read a wink as a kiss", () => {
    const f = frame({ blinkLeft: 0.05, blinkRight: 0.9, puckerScore: 0.8 });
    const got = detectRaw(f, none);
    expect(got.has("wink")).toBe(true);
    expect(got.has("blowKiss")).toBe(false);
  });

  it("does not read a wink as hands over mouth", () => {
    const f = frame({
      blinkLeft: 0.9,
      blinkRight: 0.05,
      mouth: { x: 0.5, y: 0.5 },
      hands: [hand({ wrist: { x: 0.5, y: 0.55 }, indexTip: { x: 0.5, y: 0.48 } })],
    });
    const got = detectRaw(f, none);
    expect(got.has("wink")).toBe(true);
    expect(got.has("handsOverMouth")).toBe(false);
  });

  it("suppresses other face gestures even when the wink is too slight to fire", () => {
    // Half-closed one eye: not enough to call a wink, but plenty to raise the
    // cheek. Reading nothing beats reading it as a smile.
    const f = frame({ blinkLeft: 0.35, blinkRight: 0.02, smileScore: 0.85 });
    const got = detectRaw(f, none);
    expect(got.has("wink")).toBe(false);
    expect(got.has("smile")).toBe(false);
  });

  it("still smiles through an ordinary blink", () => {
    // Both eyes shut is symmetric, so it is a blink, not a wink. Interrupting
    // a smile every few seconds would make it nearly impossible to trigger.
    const f = frame({ blinkLeft: 0.9, blinkRight: 0.9, smileScore: 0.85 });
    const got = detectRaw(f, none);
    expect(got.has("smile")).toBe(true);
    expect(got.has("wink")).toBe(false);
  });

  it("does not read prayer hands as a hand over the mouth", () => {
    // Prayer hands rest at the chin, which puts a palm inside the
    // hands-over-mouth radius. Prayer is the more specific pose.
    const f = frame({
      mouth: { x: 0.5, y: 0.45 },
      hands: [
        hand({ extended: FLAT, wrist: { x: 0.49, y: 0.70 }, indexTip: { x: 0.49, y: 0.40 } }),
        hand({ extended: FLAT, wrist: { x: 0.51, y: 0.70 }, indexTip: { x: 0.51, y: 0.40 } }),
      ],
    });
    const got = detectRaw(f, none);
    expect(got.has("pray")).toBe(true);
    expect(got.has("handsOverMouth")).toBe(false);
  });

  it("does not read two open hands merely near each other as prayer", () => {
    // Hands sit near each other constantly. Only a clearly upright pair, held
    // together along their whole length, is a prayer.
    const tilted = frame({
      hands: [
        hand({ extended: FLAT, wrist: { x: 0.45, y: 0.60 }, indexTip: { x: 0.45, y: 0.57 } }),
        hand({ extended: FLAT, wrist: { x: 0.55, y: 0.60 }, indexTip: { x: 0.55, y: 0.57 } }),
      ],
    });
    expect(detectRaw(tilted, none).has("pray")).toBe(false);
  });

  it("does not read splayed hands as prayer when only the wrists touch", () => {
    const splayed = frame({
      hands: [
        hand({ extended: FLAT, wrist: { x: 0.49, y: 0.70 }, indexTip: { x: 0.30, y: 0.40 } }),
        hand({ extended: FLAT, wrist: { x: 0.51, y: 0.70 }, indexTip: { x: 0.70, y: 0.40 } }),
      ],
    });
    expect(detectRaw(splayed, none).has("pray")).toBe(false);
  });

  it("still lets a hand gesture and a face gesture fire together", () => {
    // Exclusion is between conflicting readings only. Smiling while making a
    // peace sign is two things at once, and both are meant.
    const f = frame({
      smileScore: 0.85,
      hands: [hand({ extended: { thumb: false, index: true, middle: true, ring: false, pinky: false } })],
    });
    const got = detectRaw(f, none);
    expect(got.has("smile")).toBe(true);
    expect(got.has("peace")).toBe(true);
  });

  it("applies a looser threshold to an already-active gesture (hysteresis)", () => {
    // Below the enter threshold for smile, but above the exit threshold.
    const borderline = frame({ smileScore: 0.6 });
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

  it("fires a wink on a shorter hold than the rest", () => {
    // A real wink lasts a couple of hundred milliseconds. Requiring the full
    // hold turns it into a wink held open, which is a stare.
    const winking = (t: number) =>
      frame({ timestamp: t, blinkLeft: 0.9, blinkRight: 0.05 });
    const g = new GestureTracker();

    expect(holdFor("wink")).toBeLessThan(HOLD_MS);
    g.update(winking(0));
    expect(g.update(winking(holdFor("wink") - 1))).toEqual([]);
    expect(g.update(winking(holdFor("wink")))).toEqual(["wink"]);
  });

  it("keeps the standard hold for everything else", () => {
    expect(holdFor("smile")).toBe(HOLD_MS);
    expect(holdFor("heart")).toBe(HOLD_MS);
    expect(holdFor("blowKiss")).toBe(HOLD_MS);
  });

  it("still refuses a blink however long it lasts", () => {
    // The shorter wink window must not become a way in for blinks. Both eyes
    // closed is symmetric, so no amount of holding it should ever fire.
    const blinking = (t: number) =>
      frame({ timestamp: t, blinkLeft: 0.9, blinkRight: 0.9 });
    const g = new GestureTracker();
    g.update(blinking(0));
    expect(g.update(blinking(HOLD_MS * 3))).toEqual([]);
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
