/**
 * The shared playback state, broadcast whole rather than as play/pause/seek
 * events.
 *
 * A dropped event leaves two players permanently disagreeing and nothing to
 * notice it; a repeated state message is harmless and heals the disagreement
 * on its own. Someone opening karaoke late is corrected by the next heartbeat
 * rather than needing a special case.
 */
export interface PlaybackState {
  videoId: string | null;
  /** Position in seconds, true as of `atSharedTime`. */
  positionSec: number;
  playing: boolean;
  /** The shared-clock instant `positionSec` describes. */
  atSharedTime: number;
}

/**
 * How far out of step a player must be before it is worth seeking.
 *
 * Seeking is disruptive — it rebuffers and clicks the audio — so correcting
 * every small wobble sounds far worse than the wobble. A third of a second is
 * under the point where two people singing notice they are on different
 * words, and well above the jitter a player produces just by existing.
 */
export const DRIFT_TOLERANCE_SEC = 0.3;

/** Where the video should be right now, on the shared clock. */
export function targetPosition(state: PlaybackState, nowShared: number): number {
  if (!state.playing) return state.positionSec;
  const elapsed = (nowShared - state.atSharedTime) / 1000;
  // A negative elapsed means the instant has not arrived yet; do not rewind
  // past where the sender said the video was.
  return Math.max(0, state.positionSec + Math.max(0, elapsed));
}

export function needsCorrection(actualSec: number, targetSec: number): boolean {
  return Math.abs(actualSec - targetSec) > DRIFT_TOLERANCE_SEC;
}

/** The state to broadcast when this peer changes something. */
export function stateAt(
  videoId: string | null,
  positionSec: number,
  playing: boolean,
  nowShared: number,
): PlaybackState {
  return { videoId, positionSec, playing, atSharedTime: nowShared };
}
