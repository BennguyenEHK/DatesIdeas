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
 * every small wobble sounds far worse than the wobble.
 *
 * This was a third of a second, chosen for watching a film where it is
 * invisible. For singing it is a third of a beat: the other person sings in
 * time with their own copy, and every millisecond their copy is behind yours
 * arrives as them dragging. Two players decoding the same file drift far
 * slower than this, so the tighter figure costs almost no extra seeking.
 */
export const DRIFT_TOLERANCE_SEC = 0.12;

/** Where this player's copy of the video should be right now. */
export function targetPosition(
  state: PlaybackState,
  nowShared: number,
  offsetSec = 0,
): number {
  const elapsed = (nowShared - state.atSharedTime) / 1000;
  // A negative elapsed means the instant has not arrived yet; do not rewind
  // past where the sender said the video was.
  const sharedPosition = state.playing
    ? state.positionSec + Math.max(0, elapsed)
    : state.positionSec;
  // The offset is a listener's local accommodation for voice latency. A
  // player cannot seek before the beginning of the song.
  return Math.max(0, sharedPosition - offsetSec);
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
