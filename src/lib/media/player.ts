/**
 * What the sync layer needs from a video player, and nothing more.
 *
 * Narrow on purpose: the sync logic never touches an iframe, a YouTube global
 * or a DOM node, so it stays testable against a fake and a different player
 * could be dropped in without it noticing.
 */
export interface PlayerHandle {
  /** False until the player has loaded and can accept commands. */
  isReady(): boolean;
  load(videoId: string, startSec: number): void;
  play(): void;
  pause(): void;
  /**
   * A correction large enough to be worth fetching for: joining late, a
   * resync, a stall. May go to the network and may stall the picture.
   */
  seek(seconds: number): void;
  /**
   * A small correction to a position the player has almost certainly already
   * buffered.
   *
   * Separate from `seek` because the two cost wildly different amounts on
   * YouTube: a seek is allowed to ask the server for data it does not have,
   * which empties the buffer and freezes the picture. For a fifth of a second
   * that costs far more than the error it is fixing, and it is the reason
   * matching someone's singing used to stutter every time the turn changed.
   */
  nudge(seconds: number): void;
  /**
   * Runs slightly fast or slow so a correction is absorbed over seconds
   * instead of jumped in one frame. Returns false when the player cannot do
   * it, so the caller can fall back to nudging.
   *
   * YouTube always returns false: its API rounds any rate it does not support
   * back towards 1, so 0.97 silently becomes 1 and the only rate below normal
   * it will actually accept is 0.75 -- a quarter slower, which on music is not
   * a correction but a different song.
   */
  setRate(rate: number): boolean;
  /** Current position in seconds; 0 before the player is ready. */
  currentTime(): number;
  /**
   * 0-100, and deliberately absent from the shared playback state.
   *
   * The song never crosses the connection — each side streams it — so loudness
   * is the one karaoke setting that is genuinely personal. Turning the music
   * down here lifts the other person's voice above it without moving either
   * player off the beat.
   */
  setVolume(percent: number): void;
}
