export type HouseState = "up" | "dimming" | "down" | "rising";

/** The room closes down promptly, so the film can begin without a long wait. */
export const DIM_DOWN_MS = 3000;
/** Coming back up takes longer, which makes the return feel unhurried. */
export const DIM_UP_MS = 5000;
/** The room stays usable: a cinema is dark, but it is not pitch black. */
export const DIM_DEPTH = 0.72;

/**
 * Find the normalized house-light level at one point in a fade.
 *
 * `startingLevel` is the level already reached when a fade is interrupted.
 * That argument matters when somebody pauses halfway down: the room must rise
 * from that halfway point rather than pretending it first reached full dark.
 */
export function levelAt(
  state: HouseState,
  elapsedMs: number,
  startingLevel = state === "rising" ? 1 : 0,
): number {
  const start = clamp(startingLevel);
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : elapsedMs === Infinity ? Infinity : 0;

  if (state === "up") return 0;
  if (state === "down") return 1;
  if (state === "dimming") {
    const progress = clamp(elapsed / DIM_DOWN_MS);
    return start + (1 - start) * progress;
  }

  const progress = clamp(elapsed / DIM_UP_MS);
  return start * (1 - progress);
}

/** Choose the direction that matches the transport without losing its phase. */
export function nextState(playing: boolean, current: HouseState): HouseState {
  if (playing) {
    return current === "up" || current === "rising" ? "dimming" : current;
  }
  return current === "down" || current === "dimming" ? "rising" : current;
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
