import { MEME_IDS, type MemeId } from "@/lib/rtc/protocol";
import type { HandSummary, Point, VisionFrame } from "./types";

export const HOLD_MS = 300;
export const COOLDOWN_MS = 3000;

/**
 * A wink is over almost as soon as it starts — a couple of hundred
 * milliseconds. Asking for the full hold turns it into a wink held open, which
 * is a stare, and is why it felt so hard to trigger. Blinks cannot exploit the
 * shorter window: they close both eyes, and the symmetry check rules them out
 * regardless of how long they last.
 */
const HOLD_OVERRIDES: Partial<Record<MemeId, number>> = { wink: 150 };

export function holdFor(id: MemeId): number {
  return HOLD_OVERRIDES[id] ?? HOLD_MS;
}

/** Enter thresholds are strict; exit thresholds are loose. The gap is the hysteresis. */
const SMILE_ENTER = 0.7;
const SMILE_EXIT = 0.55;
/** Distance between the two hands' fingertips, in units of hand scale. */
const HEART_ENTER = 0.6;
const HEART_EXIT = 0.95;
/** Pursed lips. A kiss face and a smile are near mutually exclusive shapes. */
const PUCKER_ENTER = 0.85;
const PUCKER_EXIT = 0.65;
/**
 * A wink is one eye shut while the other stays open. Both thresholds AND the
 * gap between them are required, so an ordinary blink — which closes both —
 * can never satisfy it.
 */
const WINK_CLOSED = 0.4;
const WINK_OPEN = 0.35;
const WINK_GAP = 0.3;
/**
 * Deliberately looser than WINK_GAP. Closing one eye raises that cheek, and
 * the smile blendshape keys off cheek raise — so a wink pushes the smile score
 * up whether you meant it or not. Any asymmetry at all disqualifies the other
 * face gestures, even asymmetry too slight to call a wink: better to read
 * nothing than to read a wink as a smile.
 *
 * Symmetric, not open. An ordinary blink closes both eyes and must not
 * interrupt a smile that is midway through its hold.
 */
const EYES_ASYMMETRIC = 0.25;
/** Wrist separation for palms pressed together, in units of hand scale. */
const PRAY_ENTER = 0.8;
const PRAY_EXIT = 1.2;
/** How far above the wrist the fingertips must sit for hands to read as raised. */
const PRAY_UPRIGHT = 0.6;
/**
 * How far the thumb must clear the wrist vertically. Sitting on the correct
 * side of it is not enough: in a finger heart the thumbs angle downwards just
 * enough to pass that test, which is how a heart came to fire a thumbs-down.
 */
const THUMB_CLEAR = 0.5;
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

/** Thumb out, every finger in. The shape both thumbs gestures start from. */
function onlyThumb(h: HandSummary): boolean {
  const e = h.extended;
  return e.thumb && !e.index && !e.middle && !e.ring && !e.pinky;
}

function isThumbsUp(h: HandSummary): boolean {
  if (!onlyThumb(h)) return false;
  // Image coordinates: y increases downward, so "up" means a smaller y.
  return h.wrist.y - h.thumbTip.y > THUMB_CLEAR * h.scale;
}

function isThumbsDown(h: HandSummary): boolean {
  if (!onlyThumb(h)) return false;
  return h.thumbTip.y - h.wrist.y > THUMB_CLEAR * h.scale;
}

/**
 * Two hands showing nothing but a thumb, with the thumbs together.
 *
 * That is a heart being formed, not two simultaneous thumbs-downs. The index
 * fingers curve to make the top of the heart rather than straightening, so
 * they measure as curled — leaving each hand looking exactly like a thumbs
 * gesture. Nobody gives two thumbs-down at once with their thumbs touching.
 */
function isFormingHeart(hands: HandSummary[]): boolean {
  if (hands.length < 2) return false;
  const [a, b] = hands;
  if (!onlyThumb(a) || !onlyThumb(b)) return false;
  const scale = (a.scale + b.scale) / 2;
  return scale > 0 && dist(a.thumbTip, b.thumbTip) / scale < HEART_EXIT;
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
  // Clearly upright, not merely tilted: two open hands held anywhere near each
  // other would otherwise qualify, and hands are near each other constantly.
  const upright = (h: HandSummary) => h.wrist.y - h.indexTip.y > PRAY_UPRIGHT * scale;
  if (!upright(a) || !upright(b)) return false;
  // Pressed together along their whole length, not just at the wrists.
  return (
    dist(a.wrist, b.wrist) / scale < threshold &&
    dist(a.indexTip, b.indexTip) / scale < threshold
  );
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

/** One eye doing something the other is not. Disqualifies every other face read. */
function eyesAsymmetric(frame: VisionFrame): boolean {
  return Math.abs(frame.blinkLeft - frame.blinkRight) >= EYES_ASYMMETRIC;
}

/**
 * Gestures that cannot both have been meant, most specific first. When more
 * than one in a set fires, only the first survives.
 *
 * Declared as data rather than buried in each detector because the conflicts
 * are between gestures, not inside them — and because every one of these was
 * found by someone pulling a face at a camera, not by reading the code.
 */
const EXCLUSIVE: readonly (readonly MemeId[])[] = [
  // One face, one expression.
  ["wink", "blowKiss", "smile"],
  // Both bring a hand up to the mouth.
  ["blowKiss", "handsOverMouth"],
  // Prayer hands rest at the chin, close enough to read as covering the mouth.
  ["pray", "handsOverMouth"],
  // Two palms together put the fingertips together, exactly like a heart.
  ["heart", "pray"],
  // A wink must never ride along with anything else on the face.
  ["wink", "handsOverMouth"],
  // A heart is two hands doing one thing; a thumb is one hand doing another.
  // When both read at once, the two-handed shape is what was meant.
  ["heart", "thumbsDown"],
  ["heart", "thumbsUp"],
];

/** Drops any gesture shadowed by a more specific one firing at the same time. */
function resolveConflicts(found: Set<MemeId>): Set<MemeId> {
  for (const group of EXCLUSIVE) {
    const winner = group.find((id) => found.has(id));
    if (winner === undefined) continue;
    for (const id of group) if (id !== winner) found.delete(id);
  }
  return found;
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

  // Every other face gesture requires the eyes to agree with each other. This
  // is what keeps a wink from also reading as a smile or a kiss.
  const symmetric = !eyesAsymmetric(frame);

  if (symmetric && frame.smileScore >= (active.has("smile") ? SMILE_EXIT : SMILE_ENTER)) {
    out.add("smile");
  }
  // A kiss face is not a smile: requiring the smile to be low keeps one from
  // riding along on the other.
  if (
    symmetric &&
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
  if (
    symmetric &&
    isHandsOverMouth(frame, active.has("handsOverMouth") ? COVER_EXIT : COVER_ENTER)
  ) {
    out.add("handsOverMouth");
  }
  // Hands mid-heart look like two thumbs gestures. Do not read them as one.
  const formingHeart = isFormingHeart(frame.hands);
  for (const h of frame.hands) {
    if (isPeace(h)) out.add("peace");
    if (!formingHeart && isThumbsUp(h)) out.add("thumbsUp");
    if (!formingHeart && isThumbsDown(h)) out.add("thumbsDown");
  }
  return resolveConflicts(out);
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
      const heldLongEnough = t - s.heldSince >= holdFor(id);
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
