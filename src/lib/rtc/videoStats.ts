import type { StatsLike } from "./path";

/**
 * Cumulative jitter-buffer counters, as reported by one getStats() call.
 * Both are running totals for the life of the connection, not rates.
 */
export interface JitterSample {
  delaySeconds: number;
  frames: number;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * The receiving video stream's jitter-buffer totals.
 *
 * The jitter buffer is video the browser is deliberately holding back so a
 * hiccup in the network does not become a visible stutter. It is invisible in
 * every other measurement — the DataChannel ping never touches it — and on a
 * long link it can cost more than the journey itself.
 *
 * Audio is skipped on purpose: it has a separate buffer that behaves
 * differently, and averaging the two describes neither.
 */
export function readJitter(stats: StatsLike): JitterSample | null {
  for (const report of stats.values()) {
    if (report.type !== "inbound-rtp" || report.kind !== "video") continue;
    const delaySeconds = num(report.jitterBufferDelay);
    const frames = num(report.jitterBufferEmittedCount);
    if (delaySeconds === null || frames === null) return null;
    return { delaySeconds, frames };
  }
  return null;
}

/**
 * How long the average frame waited in the buffer, in milliseconds.
 *
 * Uses the difference between two samples rather than the lifetime totals, so
 * the number describes what the buffer is doing now instead of an average
 * still weighed down by however the connection started.
 */
export function jitterDelayMs(
  prev: JitterSample | null,
  cur: JitterSample,
): number | null {
  const lifetime = () =>
    cur.frames > 0 ? (cur.delaySeconds / cur.frames) * 1000 : null;

  // Nothing to compare against yet.
  if (prev === null) return lifetime();

  const dFrames = cur.frames - prev.frames;
  const dDelay = cur.delaySeconds - prev.delaySeconds;

  // Counters restarted, which an ICE restart does. A negative delta would
  // print a negative buffer time, so the lifetime figure is the truth now.
  if (dFrames < 0 || dDelay < 0) return lifetime();

  // No frames arrived between polls: the video is stalled, so there is no
  // recent measurement. Reporting the old number would imply health.
  if (dFrames === 0) return null;

  return (dDelay / dFrames) * 1000;
}
