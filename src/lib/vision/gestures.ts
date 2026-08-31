import { MEME_IDS, type MemeId } from "@/lib/rtc/protocol";
import type { HandSummary, Point, VisionFrame } from "./types";

export const HOLD_MS = 300;
export const COOLDOWN_MS = 3000;

/** Enter thresholds are strict; exit thresholds are loose. The gap is the hysteresis. */
const SMILE_ENTER = 0.55;
const SMILE_EXIT = 0.4;
/** Distance between the two hands' fingertips, in units of hand scale. */
const HEART_ENTER = 0.6;
const HEART_EXIT = 0.95;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPeace(h: HandSummary): boolean {
  const e = h.extended;
  return e.index && e.middle && !e.ring && !e.pinky;
}

function isThumbsUp(h: HandSummary): boolean {
  const e = h.extended;
  if (!e.thumb || e.index || e.middle || e.ring || e.pinky) return false;
  // Image coordinates: y increases downward, so "up" means a smaller y.
  return h.thumbTip.y < h.wrist.y;
}

function isHeart(hands: HandSummary[], threshold: number): boolean {
  if (hands.length < 2) return false;
  const [a, b] = hands;
  const scale = (a.scale + b.scale) / 2;
  if (scale <= 0) return false;
  const thumbGap = dist(a.thumbTip, b.thumbTip) / scale;
  const indexGap = dist(a.indexTip, b.indexTip) / scale;
  return thumbGap < threshold && indexGap < threshold;
}

/**
 * Per-frame gesture presence. `active` holds the gestures currently firing;
 * those get the looser exit threshold so a value sitting on the boundary
 * does not flicker on and off.
 */
export function detectRaw(
  frame: VisionFrame,
  active: ReadonlySet<MemeId>,
): Set<MemeId> {
  const out = new Set<MemeId>();

  if (frame.smileScore >= (active.has("smile") ? SMILE_EXIT : SMILE_ENTER)) {
    out.add("smile");
  }
  if (isHeart(frame.hands, active.has("heart") ? HEART_EXIT : HEART_ENTER)) {
    out.add("heart");
  }
  for (const h of frame.hands) {
    if (isPeace(h)) out.add("peace");
    if (isThumbsUp(h)) out.add("thumbsUp");
  }
  return out;
}

interface GestureState {
  heldSince: number | null;
  firedAt: number | null;
}

/**
 * Turns per-frame presence into discrete events. A raw threshold fires ~30
 * times a second; hold-time and cooldown are what make the overlay watchable.
 */
export class GestureTracker {
  private active = new Set<MemeId>();
  private state: Record<MemeId, GestureState>;

  constructor() {
    this.state = Object.fromEntries(
      MEME_IDS.map((id) => [id, { heldSince: null, firedAt: null }]),
    ) as Record<MemeId, GestureState>;
  }

  update(frame: VisionFrame): MemeId[] {
    const present = detectRaw(frame, this.active);
    const fired: MemeId[] = [];
    const t = frame.timestamp;

    for (const id of MEME_IDS) {
      const s = this.state[id];
      if (!present.has(id)) {
        s.heldSince = null;
        continue;
      }
      if (s.heldSince === null) {
        s.heldSince = t;
        continue;
      }
      const heldLongEnough = t - s.heldSince >= HOLD_MS;
      const alreadyFiredThisHold = s.firedAt !== null && s.firedAt >= s.heldSince;
      const coolingDown = s.firedAt !== null && t - s.firedAt < COOLDOWN_MS;

      if (heldLongEnough && !alreadyFiredThisHold && !coolingDown) {
        s.firedAt = t;
        fired.push(id);
      }
    }

    this.active = present;
    return fired;
  }
}
