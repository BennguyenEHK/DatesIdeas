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
/** Pursed lips. A kiss face and a smile are near mutually exclusive shapes. */
const PUCKER_ENTER = 0.5;
const PUCKER_EXIT = 0.35;
/**
 * A wink is one eye shut while the other stays open. Both thresholds AND the
 * gap between them are required, so an ordinary blink — which closes both —
 * can never satisfy it.
 */
const WINK_CLOSED = 0.5;
const WINK_OPEN = 0.3;
const WINK_GAP = 0.4;
/** Wrist separation for palms pressed together, in units of hand scale. */
const PRAY_ENTER = 1.0;
const PRAY_EXIT = 1.4;
/** Palm-to-mouth distance, in units of hand scale. */
const COVER_ENTER = 1.6;
const COVER_EXIT = 2.1;

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

function isThumbsDown(h: HandSummary): boolean {
  const e = h.extended;
  if (!e.thumb || e.index || e.middle || e.ring || e.pinky) return false;
  return h.thumbTip.y > h.wrist.y;
}

/** Ring and pinky curled in — the shape that separates a heart from a prayer. */
function curled(h: HandSummary): boolean {
  return !h.extended.ring || !h.extended.pinky;
}

function isHeart(hands: HandSummary[], threshold: number): boolean {
  if (hands.length < 2) return false;
  const [a, b] = hands;
  const scale = (a.scale + b.scale) / 2;
  if (scale <= 0) return false;
  // Two flat palms pressed together ALSO put the thumb tips and index tips
  // together, so proximity alone cannot tell a heart from a prayer. The
  // curled ring and pinky can.
  if (!curled(a) || !curled(b)) return false;
  const thumbGap = dist(a.thumbTip, b.thumbTip) / scale;
  const indexGap = dist(a.indexTip, b.indexTip) / scale;
  return thumbGap < threshold && indexGap < threshold;
}

/** Palms together, fingers up: please, sorry, thank you. */
function isPray(hands: HandSummary[], threshold: number): boolean {
  if (hands.length < 2) return false;
  const [a, b] = hands;
  const scale = (a.scale + b.scale) / 2;
  if (scale <= 0) return false;
  const flat = (h: HandSummary) =>
    h.extended.index && h.extended.middle && h.extended.ring && h.extended.pinky;
  if (!flat(a) || !flat(b)) return false;
  // Fingertips above the wrists: hands raised, not resting flat on a desk.
  if (a.indexTip.y >= a.wrist.y || b.indexTip.y >= b.wrist.y) return false;
  return dist(a.wrist, b.wrist) / scale < threshold;
}

/**
 * One eye shut, the other open. Deliberately never satisfied by a blink: that
 * closes both eyes, so the gap between them stays near zero.
 */
function isWink(frame: VisionFrame): boolean {
  const shut = Math.max(frame.blinkLeft, frame.blinkRight);
  const open = Math.min(frame.blinkLeft, frame.blinkRight);
  return shut >= WINK_CLOSED && open <= WINK_OPEN && shut - open >= WINK_GAP;
}

/** A hand raised over the mouth, rather than raised anywhere else. */
function isHandsOverMouth(frame: VisionFrame, threshold: number): boolean {
  const mouth = frame.mouth;
  if (!mouth) return false;
  // Blowing a kiss also brings a hand to the mouth; the pursed lips separate
  // them, and a kiss is the more specific reading of the two.
  if (frame.puckerScore >= PUCKER_EXIT) return false;
  return frame.hands.some((h) => {
    if (h.scale <= 0) return false;
    // Roughly the middle of the palm, which is what actually covers a mouth.
    const palm = {
      x: (h.wrist.x + h.indexTip.x) / 2,
      y: (h.wrist.y + h.indexTip.y) / 2,
    };
    return dist(palm, mouth) / h.scale < threshold;
  });
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
  // A kiss face is not a smile: requiring the smile to be low keeps one from
  // riding along on the other.
  if (
    frame.puckerScore >= (active.has("blowKiss") ? PUCKER_EXIT : PUCKER_ENTER) &&
    frame.smileScore < SMILE_ENTER
  ) {
    out.add("blowKiss");
  }
  if (isWink(frame)) out.add("wink");
  if (isHeart(frame.hands, active.has("heart") ? HEART_EXIT : HEART_ENTER)) {
    out.add("heart");
  }
  if (isPray(frame.hands, active.has("pray") ? PRAY_EXIT : PRAY_ENTER)) {
    out.add("pray");
  }
  if (isHandsOverMouth(frame, active.has("handsOverMouth") ? COVER_EXIT : COVER_ENTER)) {
    out.add("handsOverMouth");
  }
  for (const h of frame.hands) {
    if (isPeace(h)) out.add("peace");
    if (isThumbsUp(h)) out.add("thumbsUp");
    if (isThumbsDown(h)) out.add("thumbsDown");
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
