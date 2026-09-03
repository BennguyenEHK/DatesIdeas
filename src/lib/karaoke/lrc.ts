export interface LrcLine {
  /** When this line begins, in seconds from the start of the track. */
  atSec: number;
  text: string;
}

const timestampAtStart = /^\[(\d+):(\d{2})(?:\.(\d{2}|\d{3}))?\]/;
const metadataAtStart = /^\[[^:\]]+:[^\]]*\]/;
const offsetMetadata = /^offset:([+-]?\d+)$/i;

function timestampSeconds(minutesText: string, secondsText: string, fractionText?: string): number {
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  const fraction = fractionText === undefined ? 0 : Number(`0.${fractionText}`);
  const value = minutes * 60 + seconds + fraction;
  return Number.isFinite(value) ? value : NaN;
}

export function parseLrc(source: string): LrcLine[] {
  if (typeof source !== "string") return [];

  const sourceLines = source.split(/\r?\n/);
  let offsetMs = 0;

  for (const sourceLine of sourceLines) {
    const metadataMatch = sourceLine.match(/^\[([^:\]]+:[^\]]*)\]/);
    if (metadataMatch === null) continue;
    const metadata = offsetMetadata.exec(metadataMatch[1].trim());
    if (metadata === null) continue;
    const parsedOffset = Number(metadata[1]);
    if (Number.isFinite(parsedOffset)) offsetMs = parsedOffset;
  }

  const parsed: Array<LrcLine & { order: number }> = [];
  let order = 0;

  for (const sourceLine of sourceLines) {
    let remainder = sourceLine;
    const timestamps: number[] = [];

    while (true) {
      const match = timestampAtStart.exec(remainder);
      if (match === null) break;
      const seconds = timestampSeconds(match[1], match[2], match[3]);
      if (!Number.isFinite(seconds)) {
        timestamps.length = 0;
        break;
      }
      timestamps.push(seconds);
      remainder = remainder.slice(match[0].length);
    }

    if (timestamps.length === 0) {
      // Metadata describes the file, so showing it as a lyric would put non-song text on screen.
      if (metadataAtStart.test(sourceLine)) continue;
      continue;
    }

    // A space after the timestamp is a formatting separator in common LRC files, not part of the lyric.
    const text = remainder.trimStart();
    for (const timestamp of timestamps) {
      // LRC defines a positive offset as lyrics arriving early, so it is subtracted even though that reads backwards.
      const atSec = Math.max(0, timestamp - offsetMs / 1000);
      if (!Number.isFinite(atSec)) continue;
      parsed.push({ atSec, text, order });
      order += 1;
    }
  }

  parsed.sort((left, right) => left.atSec - right.atSec || left.order - right.order);
  return parsed.map(({ atSec, text }) => ({ atSec, text }));
}

export function lineIndexAt(lines: readonly LrcLine[], sec: number): number {
  // Animation frames call this repeatedly, so binary search keeps lookup logarithmic as the song grows.
  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (lines[middle].atSec <= sec) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}
