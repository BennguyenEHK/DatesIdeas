/**
 * Whose music moves, and by how much.
 *
 * Two people sing along to two copies of one song. Their voice spends a couple
 * of hundred milliseconds crossing the internet while your song carries on
 * without it, so they always sound like they are dragging — even though they
 * are singing perfectly in time with their own copy. Rewinding YOUR music by
 * that same amount lines the two up.
 *
 * The thing that is easy to get wrong: only the listener can do this. Delaying
 * both sides by the same amount does not halve the problem, it does nothing at
 * all. If your music runs `a` behind and theirs runs `b` behind, what you hear
 * is off by `latency - a + b` — the two shifts subtract, and equal shifts
 * cancel exactly, leaving the gap precisely where it started. Worse, you are
 * now singing behind your own copy too, so your voice reaches them later than
 * before. That is why this is decided by whose turn it is rather than left as
 * a switch each of you can leave on.
 */

/** Which of you the delay is currently accommodating. */
export type SingingTurn = "you" | "them" | "nobody";

/** The furthest the music can be pulled back, in milliseconds. */
export const MAX_OFFSET_MS = 1000;

/**
 * How much the measured figure must move before the music follows it.
 *
 * Every change to the offset re-seeks the player, which rebuffers and clicks
 * the audio. A connection's measured latency wobbles by a few milliseconds
 * from one reading to the next, and following every wobble would be an
 * audible stutter in exchange for a correction nobody can hear.
 */
export const OFFSET_STEP_MS = 40;

/**
 * Both singing is a duet, and neither is a pause. In both cases no offset can
 * be right — a duet would need each side shifted in opposite directions at
 * once — so the honest answer is to leave the song where it is.
 */
export function singingTurn(mine: boolean, theirs: boolean): SingingTurn {
  if (theirs && !mine) return "them";
  if (mine && !theirs) return "you";
  return "nobody";
}

/**
 * How late their voice actually arrives: half the round trip, plus however
 * long their audio is sitting in this browser's jitter buffer.
 *
 * The buffer matters as much as the network. It is audio the browser is
 * deliberately holding back to smooth out uneven arrivals, and it is invisible
 * to a round-trip measurement, which times a text message that never touches
 * it. Leaving it out understates the delay by most of its length on a bad link.
 */
export function measuredLatencyMs(
  rttMs: number,
  audioJitterMs: number | null,
): number | null {
  if (!Number.isFinite(rttMs) || rttMs <= 0) return null;
  const jitter =
    audioJitterMs !== null && Number.isFinite(audioJitterMs) && audioJitterMs > 0
      ? audioJitterMs
      : 0;
  return Math.round(rttMs / 2 + jitter);
}

/**
 * The median of the recent readings, not the mean.
 *
 * One packet caught behind a burst of traffic reports a latency several times
 * the truth. A mean carries that outlier into the answer and lurches the song;
 * a median discards it entirely, which is the whole reason to keep a window of
 * samples rather than using the newest one.
 */
export function smoothLatency(samples: readonly number[]): number | null {
  const usable = samples.filter((s) => Number.isFinite(s) && s >= 0);
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median);
}

/** Clamped, because a measurement is not a promise and the player still has to
 *  land somewhere sane. */
export function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.min(MAX_OFFSET_MS, Math.round(ms)));
}

/**
 * Where this side's music should sit for the turn currently being taken.
 *
 * Only "them" moves anything. On your own turn the offset is zero on purpose
 * rather than merely unused: singing behind your own copy is what makes your
 * voice reach them twice as late, so your turn has to actively put the music
 * back rather than leave the last listener's figure in place.
 */
export function offsetForTurn(
  turn: SingingTurn,
  latencyMs: number | null,
): number {
  if (turn !== "them" || latencyMs === null) return 0;
  return clampOffset(latencyMs);
}

/**
 * Holds the applied offset still until the measurement has genuinely moved.
 *
 * Zero is exempt from the deadband in both directions: going to and from
 * "no delay at all" is a turn changing hands, which must land immediately
 * however small the figure was.
 */
export function settledOffset(current: number, next: number): number {
  if (next === 0 || current === 0) return next;
  return Math.abs(next - current) >= OFFSET_STEP_MS ? next : current;
}
