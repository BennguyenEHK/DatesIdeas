/**
 * A 60 MB source limit, and it is about memory rather than bandwidth: the file
 * never leaves this machine.
 *
 * What has to fit is not the file but what it becomes. Decoding throws the
 * compression away, and stereo 44.1 kHz float is 44100 x 2 x 4 bytes a second,
 * or a little over 21 MB per MINUTE. Sixty megabytes is chosen to admit an
 * uncompressed WAV of an ordinary song rather than to bound the decoded size,
 * which for a song-length track lands in the low hundreds of megabytes.
 */
export const MAX_TRACK_MB = 60;

/** The narrowest slice of AudioContext this module needs, so it is testable. */
export interface DecodeTarget {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

export type DecodeFailure = "too-big" | "unreadable" | "not-audio" | "empty";

export type DecodeResult =
  | { ok: true; buffer: AudioBuffer; durationSec: number }
  | { ok: false; reason: DecodeFailure };

/** Reports the selected file's size in mebibytes for the same memory budget. */
export function trackSizeMb(file: Blob): number {
  return Math.round((file.size / (1024 * 1024)) * 10) / 10;
}

/** Decodes a selected file without allowing browser failures to escape. */
export async function decodeTrack(file: Blob, target: DecodeTarget): Promise<DecodeResult> {
  let size: number;
  try {
    size = file.size;
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  if (size === 0) return { ok: false, reason: "empty" };
  if (size > MAX_TRACK_MB * 1024 * 1024) return { ok: false, reason: "too-big" };

  let data: ArrayBuffer;
  try {
    const candidate = file as unknown as { arrayBuffer?: unknown };
    if (typeof candidate.arrayBuffer !== "function") {
      return { ok: false, reason: "unreadable" };
    }

    const value = await (candidate.arrayBuffer as () => Promise<unknown>)();
    if (!(value instanceof ArrayBuffer)) return { ok: false, reason: "unreadable" };
    data = value;
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  let buffer: AudioBuffer;
  try {
    buffer = await target.decodeAudioData(data);
  } catch {
    return { ok: false, reason: "not-audio" };
  }

  try {
    if (buffer.duration <= 0 || buffer.numberOfChannels <= 0) {
      return { ok: false, reason: "empty" };
    }
    return { ok: true, buffer, durationSec: buffer.duration };
  } catch {
    return { ok: false, reason: "not-audio" };
  }
}
