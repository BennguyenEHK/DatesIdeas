/**
 * A quiet pocket around the seek that changes hands between singers.
 *
 * A seek cannot be made gentle by the YouTube player: it stops and starts the
 * decoder. Hiding that restart under silence is therefore kinder than asking
 * the player to do something it cannot do, and keeping the schedule here makes
 * the caller responsible only for applying the already-decided steps.
 */

/** Fading out faster than this is itself audible as a click. */
export const DUCK_DOWN_MS = 120;
/** Silence held around the seek, so the seek has somewhere to hide. */
export const DUCK_HOLD_MS = 90;
/** Coming back slower than going away is what makes the dip feel deliberate. */
export const DUCK_UP_MS = 260;
/** How often a step is emitted. */
export const DUCK_TICK_MS = 20;

export interface DuckStep {
  /** Milliseconds after the plan starts. */
  atMs: number;
  /** 0-100, on the same scale as the player's own volume control. */
  volume: number;
}

/** The instant the caller should perform the seek: the middle of the silence. */
export function duckSilentAtMs(): number {
  return DUCK_DOWN_MS + DUCK_HOLD_MS / 2;
}

/** Total length of the plan. */
export function duckTotalMs(): number {
  return DUCK_DOWN_MS + DUCK_HOLD_MS + DUCK_UP_MS;
}

/**
 * The whole fade, from `volume` down to silence and back to `volume`.
 *
 * Phase boundaries are included even when they do not land on the caller's
 * tick grid. That gives the seek an exact silent interval and gives the final
 * step an exact restoration point, rather than asking timing or rounding to
 * repair either promise later.
 */
export function duckPlan(volume: number, tickMs = DUCK_TICK_MS): DuckStep[] {
  const safeVolume = clampVolume(volume);
  const safeTick = Number.isFinite(tickMs) && tickMs > 0 ? tickMs : DUCK_TICK_MS;
  const total = duckTotalMs();
  const holdStart = DUCK_DOWN_MS;
  const holdEnd = DUCK_DOWN_MS + DUCK_HOLD_MS;
  const times = new Set<number>([0, holdStart, holdEnd, total]);

  // The grid keeps the caller's updates regular; the explicit endpoints above
  // keep the important musical events exact when a tick does not divide them.
  for (let atMs = safeTick; atMs < total; atMs += safeTick) {
    times.add(atMs);
  }

  return [...times]
    .sort((a, b) => a - b)
    .map((atMs) => ({ atMs, volume: volumeAt(atMs, safeVolume) }));
}

/**
 * Whether a correction of this size is worth hiding at all.
 *
 * A dip costs about two thirds of a second of music. For a correction small
 * enough to pass unnoticed the cure is worse than the disease, so tiny
 * corrections should just be applied bare.
 */
export const DUCK_WORTH_IT_SEC = 0.15;

export function worthDucking(errorSec: number): boolean {
  return Number.isFinite(errorSec) && Math.abs(errorSec) >= DUCK_WORTH_IT_SEC;
}

function clampVolume(volume: number): number {
  if (Number.isNaN(volume)) return 0;
  if (volume === Infinity) return 100;
  if (volume === -Infinity) return 0;
  return Math.round(Math.max(0, Math.min(100, volume)));
}

function volumeAt(atMs: number, volume: number): number {
  if (atMs <= DUCK_DOWN_MS) {
    return Math.round(volume * (1 - atMs / DUCK_DOWN_MS));
  }
  const holdEnd = DUCK_DOWN_MS + DUCK_HOLD_MS;
  if (atMs <= holdEnd) return 0;
  return Math.round(volume * ((atMs - holdEnd) / DUCK_UP_MS));
}
