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

/** Which part someone is playing when both are singing at once. */
export type DuetRole = "anchor" | "follower" | "none";

/** The furthest the music can be pulled back, in milliseconds. */
export const MAX_OFFSET_MS = 1000;

/**
 * The most jitter-buffer delay that may move the music, in milliseconds.
 *
 * A modest steady buffer is a real part of when the voice arrives and belongs
 * in the offset. A much larger reading is a temporary stall while the browser
 * covers congestion, not a new property of the route. Charging that entire
 * stall to the backing track would make the song late once the audio recovers,
 * so the diagnostics keep reporting the full reading while the music only
 * follows this bounded contribution.
 */
export const MAX_JITTER_CONTRIBUTION_MS = 200;

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
 * Resolves the asymmetric roles a duet needs.
 *
 * When both sides sing, the sum of their perceived misalignments is always 2d
 * (where d is the network latency), no matter what offsets either side chooses.
 * This makes a symmetric solution impossible — there is no way for both sides to
 * perceive perfect alignment at the same time. The only escape is asymmetry: the
 * anchor locks its music at zero and never chases, while the follower absorbs
 * the entire latency. This arrangement gives the follower a perfect metronome
 * while the anchor must endure the full lag — which is why the anchor is told
 * not to follow rather than merely left unshifted.
 *
 * Musicians reach the same arrangement without being asked: between roughly 25
 * and 60 milliseconds, players stop trying to match each other and settle into
 * a starter and a joiner. Which of the two is which is a choice, not something
 * the connection decides; on a two-person link the delay is the same in both
 * directions, so there is no better or worse end to anchor from.
 */
export function duetRole(
  mine: boolean,
  theirs: boolean,
  iAmAnchor: boolean,
): DuetRole {
  if (!mine || !theirs) return "none";
  return iAmAnchor ? "anchor" : "follower";
}

/**
 * The offset for a duet, which unlike a turn is decided by role, not by who
 * sings.
 *
 * The anchor never shifts: it is the metronome and must not chase the follower
 * or they will chase it in return, creating a feedback loop. The follower
 * absorbs all the latency. A null latency or non-finite value falls back to
 * zero, as does the "none" role.
 */
export function offsetForDuet(
  role: DuetRole,
  latencyMs: number | null,
): number {
  if (role === "anchor" || role === "none") return 0;
  if (latencyMs === null) return 0;
  return clampOffset(latencyMs);
}

/**
 * How late their voice actually arrives: half the round trip, plus however
 * long their audio is sitting in this browser's jitter buffer.
 *
 * A steady buffer matters as much as the network. It is audio the browser is
 * deliberately holding back to smooth out uneven arrivals, and it is invisible
 * to a round-trip measurement, which times a text message that never touches
 * it. A stall-sized buffer is deliberately bounded here: it belongs in the
 * diagnostics, but must not rewrite where the song sits after the stall ends.
 */
export function measuredLatencyMs(
  rttMs: number,
  audioJitterMs: number | null,
): number | null {
  if (!Number.isFinite(rttMs) || rttMs <= 0) return null;
  const jitter =
    audioJitterMs !== null && Number.isFinite(audioJitterMs) && audioJitterMs > 0
      ? Math.min(audioJitterMs, MAX_JITTER_CONTRIBUTION_MS)
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
