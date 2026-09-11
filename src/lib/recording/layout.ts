/**
 * Where the two faces go on a recorded frame.
 *
 * Pure arithmetic, kept apart from the canvas so it can be tested without one.
 * The same reasoning as `stripLayout` in the photo booth: the interesting part
 * of drawing is deciding where things go, and that part should not need a DOM
 * to check.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A recorded call is 16:9, because that is what a video file should be. */
export const RECORDING_WIDTH = 1280;
export const RECORDING_HEIGHT = 720;

/** Frames a second. Enough for faces talking; cheap enough to run beside a call. */
export const RECORDING_FPS = 24;

/** The gap between the two tiles, and around them. */
const GUTTER = 8;

/**
 * Two side-by-side tiles, or one filling the frame.
 *
 * Side by side rather than picture-in-picture, and that is the whole point of
 * the feature: what you want to watch back is the two of you reacting to each
 * other, which a small inset corner throws away. Neither face is the main one.
 */
export function pairLayout(
  width: number,
  height: number,
  count: 1 | 2,
): Rect[] {
  if (count === 1) {
    return [{ x: 0, y: 0, width, height }];
  }
  const tileWidth = (width - GUTTER * 3) / 2;
  const tileHeight = height - GUTTER * 2;
  return [
    { x: GUTTER, y: GUTTER, width: tileWidth, height: tileHeight },
    { x: GUTTER * 2 + tileWidth, y: GUTTER, width: tileWidth, height: tileHeight },
  ];
}

/**
 * How to draw a source of one shape into a box of another without squashing it.
 *
 * Returns the source rectangle to sample, cropping the long edge -- the "cover"
 * behaviour, matching how the tiles look live. Letterboxing instead would
 * record black bars that are not on anybody's screen, and the recording should
 * look like the call did.
 */
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): Rect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(0, sourceWidth), height: Math.max(0, sourceHeight) };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const boxAspect = boxWidth / boxHeight;

  if (sourceAspect > boxAspect) {
    // Source is wider: take a full-height slice from the middle.
    const cropWidth = sourceHeight * boxAspect;
    return { x: (sourceWidth - cropWidth) / 2, y: 0, width: cropWidth, height: sourceHeight };
  }
  // Source is taller: take a full-width slice from the middle.
  const cropHeight = sourceWidth / boxAspect;
  return { x: 0, y: (sourceHeight - cropHeight) / 2, width: sourceWidth, height: cropHeight };
}

/** How long a recording is allowed to run, in milliseconds. */
export const MAX_RECORDING_MS = 30 * 60 * 1000;

/** Formats a running duration as m:ss, or h:mm:ss once it has earned an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
