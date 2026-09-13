export const POSTER_MAX_EDGE = 640;
export const POSTER_QUALITY = 0.72;

const POSTER_TIMEOUT_MS = 10_000;

function waitForEvent(
  element: HTMLVideoElement,
  eventName: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onEvent = (): void => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("poster timed out"));
    }, POSTER_TIMEOUT_MS);

    // A declaration rather than a const arrow, so it is hoisted and both the
    // listener and the timer above can name it before it is written. Neither
    // can actually run until this function has finished setting them up.
    function cleanup(): void {
      element.removeEventListener(eventName, onEvent);
      clearTimeout(timer);
    }

    element.addEventListener(eventName, onEvent, { once: true });
  });
}

function imageLoaded(image: HTMLImageElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("image decode failed")), { once: true });
  });
}

/**
 * Make a small JPEG still from a photograph. Unsupported formats and browsers
 * without canvas support are deliberately harmless: the original can still
 * be uploaded and displayed.
 */
export async function stillFromImage(
  file: Blob,
  options?: { document?: Document },
): Promise<Blob | null> {
  const documentRef = options?.document ?? globalThis.document;
  let objectUrl: string | null = null;
  let bitmap: ImageBitmap | null = null;

  try {
    if (documentRef === undefined) return null;

    let width: number;
    let height: number;
    let source: CanvasImageSource;
    if (typeof globalThis.createImageBitmap === "function") {
      bitmap = await globalThis.createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    } else {
      objectUrl = URL.createObjectURL(file);
      const image = documentRef.createElement("img");
      const loaded = imageLoaded(image);
      image.src = objectUrl;
      await loaded;
      width = image.naturalWidth;
      height = image.naturalHeight;
      source = image;
    }

    if (width <= 0 || height <= 0) return null;
    if (file.type.toLowerCase() === "image/jpeg" &&
      width <= POSTER_MAX_EDGE && height <= POSTER_MAX_EDGE) return null;

    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = documentRef.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(source, 0, 0, targetWidth, targetHeight);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", POSTER_QUALITY);
    });
  } catch {
    return null;
  } finally {
    if (bitmap !== null) {
      try { bitmap.close(); } catch { /* A partial bitmap may already be closed. */ }
    }
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * A poster is deliberately best-effort: an unsupported codec should leave an
 * upload usable, rather than make the memory disappear with the failed decode.
 */
export async function posterFromVideo(
  file: Blob,
  options?: { seekToSec?: number; document?: Document },
): Promise<Blob | null> {
  const documentRef = options?.document ?? globalThis.document;
  let objectUrl: string | null = null;
  let video: HTMLVideoElement | null = null;

  try {
    objectUrl = URL.createObjectURL(file);
    video = documentRef.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    const metadata = waitForEvent(video, "loadedmetadata");
    video.src = objectUrl;
    await metadata;

    if (!Number.isFinite(video.duration) || video.duration <= 0) return null;
    const requested = options?.seekToSec ?? 1;
    video.currentTime = Math.min(Math.max(0, requested), video.duration / 2);
    await waitForEvent(video, "seeked");

    if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = documentRef.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(video, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", POSTER_QUALITY);
    });
  } catch {
    return null;
  } finally {
    if (video !== null) {
      try { video.src = ""; } catch { /* A partial element can still be removed. */ }
      try { video.remove(); } catch { /* Releasing the object URL is the important part. */ }
    }
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  }
}
