export interface Frame {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export const MAX_CAPTURE_WIDTH = 1280;

/**
 * Captures the current video image at a useful size for the photo strip.
 * A frame can disappear while media is starting, so callers can treat a
 * missing result as one missing photograph instead of breaking the strip.
 */
export function captureFrame(
  video: HTMLVideoElement | null,
  options?: { mirrored?: boolean; maxWidth?: number },
): Frame | null {
  if (
    video === null ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !Number.isFinite(video.videoWidth) ||
    !Number.isFinite(video.videoHeight) ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return null;
  }

  const maxWidth =
    typeof options?.maxWidth === "number" &&
    Number.isFinite(options.maxWidth) &&
    options.maxWidth > 0
      ? options.maxWidth
      : MAX_CAPTURE_WIDTH;
  const width = Math.round(Math.min(video.videoWidth, maxWidth));
  const height = Math.round((video.videoHeight / video.videoWidth) * width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (context === null) return null;

  if (options?.mirrored === true) {
    // People pose against their mirrored preview, so keeping that orientation
    // makes the photograph look like the image they posed for.
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, width, height);
    context.restore();
  } else {
    context.drawImage(video, 0, 0, width, height);
  }

  return { canvas, width, height };
}

/**
 * Converts a captured canvas asynchronously because browsers may decline a
 * requested encoding, in which case the strip should simply omit the image.
 */
export function frameToBlob(
  frame: Frame,
  type = "image/png",
): Promise<Blob | null> {
  return new Promise((resolve) => {
    frame.canvas.toBlob((blob) => resolve(blob), type);
  });
}
