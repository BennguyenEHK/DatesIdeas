/**
 * Where the prints of a day go when its stack fans out, as a pure function.
 *
 * Cards pivot from below the stack along an arc, like a hand of cards: the
 * middle one stands straight and highest, the outer ones lean out and sit a
 * little lower. A day with more memories than fit shows the first ones and a
 * last card saying how many more there are.
 */

/** Most cards in a fan, including the "+N more" card. */
export const FAN_MAX = 7;
/** Degrees between the outermost cards. */
export const FAN_SPREAD_DEG = 56;
/** Distance from the pivot to a card, in pixels. */
export const FAN_RADIUS = 150;

export type FanCard =
  | { kind: "print"; index: number; rotateDeg: number; x: number; y: number }
  | { kind: "more"; hidden: number; rotateDeg: number; x: number; y: number };

const round = (value: number) => Math.round(value * 10) / 10 + 0;

export function fanLayout(count: number): FanCard[] {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (total === 0) return [];
  const shown = Math.min(total, FAN_MAX);
  const overflow = total > FAN_MAX;

  return Array.from({ length: shown }, (_, slot): FanCard => {
    const angle = shown === 1 ? 0 : -FAN_SPREAD_DEG / 2 + (FAN_SPREAD_DEG * slot) / (shown - 1);
    const radians = (angle * Math.PI) / 180;
    const place = {
      rotateDeg: round(angle),
      x: round(Math.sin(radians) * FAN_RADIUS),
      y: round((1 - Math.cos(radians)) * FAN_RADIUS),
    };
    return overflow && slot === shown - 1
      ? { kind: "more", hidden: total - (FAN_MAX - 1), ...place }
      : { kind: "print", index: slot, ...place };
  });
}

/** How many print edges peek out behind the top photograph of a closed stack. */
export function stackEdges(count: number): 0 | 1 | 2 {
  if (!Number.isFinite(count) || count <= 1) return 0;
  return count === 2 ? 1 : 2;
}
