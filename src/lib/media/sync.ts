import type { PlaybackSource } from "@/lib/rtc/protocol";

/**
 * The shared playback state, broadcast whole rather than as play/pause/seek
 * events.
 *
 * A dropped event leaves two players permanently disagreeing and nothing to
 * notice it; a repeated state message is harmless and heals the disagreement
 * on its own. Someone opening karaoke late is corrected by the next heartbeat
 * rather than needing a special case.
 */
/**
 * What is being watched, as opposed to where in it you are.
 *
 * Kept together because the three travel together and are meaningless apart:
 * an id without its source could be a YouTube video or a filename, and a
 * local film's length is the only way to notice the two of you opened
 * different files.
 */
export interface Film {
  videoId: string | null;
  source: PlaybackSource;
  /** Null for YouTube, where the same id cannot disagree, and until a local
   *  file has reported its metadata. */
  durationSec: number | null;
}

export const NO_FILM: Film = {
  videoId: null,
  source: "youtube",
  durationSec: null,
};

export interface PlaybackState extends Film {
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

/**
 * The largest tempo change a local player may use to catch up without making
 * the song feel like it changed speed.
 */
export const RAMP_RATE = 0.03;

/**
 * A correction that takes longer than this leaves the players visibly apart
 * for too long, so it is cheaper to move the playhead instead.
 */
export const MAX_RAMP_SEC = 8;

/**
 * How far a correction may reach and still be treated as certainly buffered.
 *
 * The distinction matters only on YouTube, where a seek is allowed to ask the
 * server for data it does not have -- which empties the buffer and freezes the
 * picture -- while a nudge is refused rather than fetched. A player mid-song
 * holds far more than a couple of seconds either side of where it is, so a
 * correction this small is always already in hand.
 *
 * It has to be comfortably larger than the largest delay the singing turn can
 * ask for, or the one case this exists for -- a turn changing hands -- would
 * fall through to the seek it is meant to avoid.
 */
export const NUDGE_LIMIT_SEC = 2;

/**
 * Turns a small position error into a bounded tempo correction.
 *
 * `errorSec` is actual minus wanted: an ahead player has to slow down, while
 * a behind player has to run fast. At three percent, every second held erases
 * three hundredths of a second of error.
 */
export function rampPlan(errorSec: number): { rate: number; forSec: number } | null {
  const magnitude = Math.abs(errorSec);
  if (magnitude <= DRIFT_TOLERANCE_SEC) return null;

  const forSec = magnitude / RAMP_RATE;
  if (forSec > MAX_RAMP_SEC) return null;

  return { rate: errorSec > 0 ? 1 - RAMP_RATE : 1 + RAMP_RATE, forSec };
}

/**
 * How far two local copies may differ in length and still be the same film.
 *
 * Encoders disagree about trailing silence and containers round differently,
 * so identical films routinely differ by a fraction of a second. A different
 * cut, or a different film entirely, differs by minutes.
 */
export const DURATION_MATCH_SEC = 2;

/**
 * Whether two people opened the same file.
 *
 * Only asked of local films: with YouTube both sides fetch the same id and
 * cannot disagree. Unknown lengths pass, because a file that has not reported
 * its metadata yet is not evidence of a mismatch — and accusing someone of
 * opening the wrong film while their video is still loading is worse than
 * saying nothing.
 */
export function filmsMatch(mine: Film, theirs: Film): boolean {
  if (mine.source !== "local" || theirs.source !== "local") return true;
  if (mine.durationSec === null || theirs.durationSec === null) return true;
  return Math.abs(mine.durationSec - theirs.durationSec) <= DURATION_MATCH_SEC;
}

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
  film: Film,
  positionSec: number,
  playing: boolean,
  nowShared: number,
): PlaybackState {
  return { ...film, positionSec, playing, atSharedTime: nowShared };
}
