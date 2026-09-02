import type { ShotCount } from "./strip";

export const LEAD_MS = 7000;
export const BETWEEN_MS = 7000;
export const REVEAL_MS = 700;

export type BoothStep =
  | { at: number; kind: "count"; shotIndex: number; value: number }
  | { at: number; kind: "flash"; shotIndex: number }
  | { at: number; kind: "reveal" };

function requireShotCount(shots: number): asserts shots is ShotCount {
  if (shots !== 2 && shots !== 4) {
    throw new TypeError("shots must be 2 or 4");
  }
}

function requireStartAt(startAt: number): void {
  if (!Number.isFinite(startAt)) {
    throw new TypeError("startAt must be a finite number");
  }
}

/**
 * Anchoring every step to the shared start instant keeps both participants'
 * schedules identical even though neither machine owns the other's timer.
 */
export function boothTimeline(startAt: number, shots: ShotCount): BoothStep[] {
  requireStartAt(startAt);
  requireShotCount(shots);

  const steps: BoothStep[] = [];
  for (let shotIndex = 0; shotIndex < shots; shotIndex += 1) {
    const flashAt = startAt + LEAD_MS + shotIndex * BETWEEN_MS;
    for (let value = 7; value >= 1; value -= 1) {
      steps.push({ at: flashAt - value * 1000, kind: "count", shotIndex, value });
    }
    steps.push({ at: flashAt, kind: "flash", shotIndex });
  }

  const finalFlashAt = startAt + LEAD_MS + (shots - 1) * BETWEEN_MS;
  steps.push({ at: finalFlashAt + REVEAL_MS, kind: "reveal" });
  return steps;
}

/**
 * Computing from the final flash preserves the reveal boundary used by the
 * timeline, so callers can reserve the full session before scheduling it.
 */
export function boothDurationMs(shots: ShotCount): number {
  requireShotCount(shots);
  return LEAD_MS + (shots - 1) * BETWEEN_MS + REVEAL_MS;
}
