/**
 * A 60 MB source limit keeps the held bytes reasonable: this copy stays in
 * memory and is shipped over the data channel to the other person.
 */
export const MAX_TRACK_MB = 60;

export type MediaFailure = "too-big" | "unreadable" | "empty" | "no-duration";

export type MediaResult =
  | { ok: true; file: File; durationSec: number }
  | { ok: false; reason: MediaFailure };

export interface DurationProbe {
  (blob: Blob): Promise<number>;
}

/** Reports the selected file's size in mebibytes for the same memory budget. */
export function trackSizeMb(file: Blob): number {
  return Math.round((file.size / (1024 * 1024)) * 10) / 10;
}

/** Prepares a selected video without allowing browser failures to escape. */
export async function prepareTrack(
  blob: Blob,
  durationHintSec: number | null,
  probe: DurationProbe,
): Promise<MediaResult> {
  let size: number;
  try {
    size = blob.size;
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  if (size === 0) return { ok: false, reason: "empty" };
  if (size > MAX_TRACK_MB * 1024 * 1024) return { ok: false, reason: "too-big" };

  let durationSec: number;
  if (typeof durationHintSec === "number" && Number.isFinite(durationHintSec) && durationHintSec > 0) {
    durationSec = durationHintSec;
  } else {
    try {
      durationSec = await probe(blob);
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, reason: "no-duration" };
  }

  try {
    return { ok: true, file: new File([blob], "track.mp4", { type: "video/mp4" }), durationSec };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * How long to wait for a file's length before giving up on it.
 *
 * Reading metadata off a local file is near-instant, so this is not a budget so
 * much as a floor under the one outcome the events cannot express: a decoder
 * that neither succeeds nor fails. Without it that file leaves the panel saying
 * it is still reading, forever, with no way back except a reload.
 */
const PROBE_TIMEOUT_MS = 10_000;

/** Uses metadata rather than playback so a picked file can join an existing room. */
export const probeVideoDuration: DurationProbe = (blob) => new Promise((resolve, reject) => {
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(blob);
  let settled = false;

  const finish = (result: number | Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // Cleared before revoking: a src still pointing at a revoked URL is how a
    // browser gets asked to re-read bytes that are no longer there.
    video.removeAttribute("src");
    URL.revokeObjectURL(objectUrl);
    if (typeof result === "number") resolve(result);
    else reject(result);
  };

  const timer = setTimeout(
    () => finish(new Error("Video metadata took too long to read.")),
    PROBE_TIMEOUT_MS,
  );

  video.onloadedmetadata = () => finish(video.duration);
  video.onerror = () => finish(new Error("Video metadata could not be read."));
  // Without this a browser is free to fetch nothing at all until asked to play,
  // and the metadata event this waits on would never arrive.
  video.preload = "metadata";
  video.src = objectUrl;
});
