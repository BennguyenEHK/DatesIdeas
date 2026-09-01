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
  seek(seconds: number): void;
  /** Current position in seconds; 0 before the player is ready. */
  currentTime(): number;
}
