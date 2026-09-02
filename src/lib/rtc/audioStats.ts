import type { StatsLike } from "./path";

/**
 * Cumulative inbound-audio counters, as reported by one getStats() call.
 * The delay and emitted count are running totals for the life of the
 * connection, not rates.
 */
export interface AudioSample {
  delaySeconds: number;
  emitted: number;
  bytes: number;
  atMs: number;
}

export interface AudioFormat {
  codec: string;
  clockRateHz: number | null;
  channels: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

/**
 * The receiving audio stream's jitter-buffer totals and report timestamp.
 *
 * The jitter buffer is audio the browser is deliberately holding back so a
 * hiccup in the network does not become a click or gap. It is invisible in
 * every other measurement — the DataChannel ping never touches it — and it
 * is the delay estimate the sing-along offset needs.
 */
export function readAudio(stats: StatsLike): AudioSample | null {
  for (const report of stats.values()) {
    if (report.type !== "inbound-rtp" || report.kind !== "audio") continue;

    const delaySeconds = num(report.jitterBufferDelay);
    const emitted = num(report.jitterBufferEmittedCount);
    const bytes = num(report.bytesReceived);
    const atMs = num(report.timestamp);
    if (
      delaySeconds === null ||
      emitted === null ||
      bytes === null ||
      atMs === null
    ) {
      return null;
    }
    return { delaySeconds, emitted, bytes, atMs };
  }
  return null;
}

/**
 * How long the average audio sample waited in the buffer, in milliseconds.
 *
 * Uses the difference between two samples rather than the lifetime totals, so
 * the number describes what the buffer is doing now instead of an average
 * still weighed down by however the connection started.
 */
export function audioJitterMs(
  prev: AudioSample | null,
  cur: AudioSample,
): number | null {
  const lifetime = () =>
    cur.emitted > 0 ? (cur.delaySeconds / cur.emitted) * 1000 : null;

  // Nothing to compare against yet.
  if (prev === null) return lifetime();

  const dEmitted = cur.emitted - prev.emitted;
  const dDelay = cur.delaySeconds - prev.delaySeconds;

  // Counters restarted, which an ICE restart does. A negative delta would
  // print a negative buffer time, so the lifetime figure is the truth now.
  if (dEmitted < 0 || dDelay < 0) return lifetime();

  // No samples arrived between polls: the audio is stalled, so there is no
  // recent measurement. Reporting the old number would imply health.
  if (dEmitted === 0) return null;

  // jitterBufferEmittedCount counts samples, not packets. The mean delay per
  // emitted sample is still the correct division for audio.
  return (dDelay / dEmitted) * 1000;
}

/**
 * The recent inbound-audio bitrate, in kilobits per second.
 *
 * A short window is too noisy to describe a live stream, so wait for at least
 * half a second before reporting it.
 */
export function audioBitrateKbps(
  prev: AudioSample | null,
  cur: AudioSample,
): number | null {
  if (prev === null) return null;

  const dBytes = cur.bytes - prev.bytes;
  const dMs = cur.atMs - prev.atMs;
  if (dBytes <= 0 || dMs <= 0 || dMs < 500) return null;

  return (dBytes * 8) / dMs;
}

/**
 * The codec and negotiated audio shape actually used by the inbound stream.
 *
 * The offer is not enough here: the answer can collapse a call to narrowband
 * audio, which is exactly the filtered sound this diagnostic is meant to find.
 */
export function readAudioFormat(stats: StatsLike): AudioFormat | null {
  for (const report of stats.values()) {
    if (report.type !== "inbound-rtp" || report.kind !== "audio") continue;

    const codecId = str(report.codecId);
    if (codecId === null) return null;
    const codecReport = stats.get(codecId);
    const mimeType = str(codecReport?.mimeType);
    if (mimeType === null) return null;

    const slash = mimeType.indexOf("/");
    if (slash < 0 || slash === mimeType.length - 1) return null;

    return {
      codec: mimeType.slice(slash + 1).toLowerCase(),
      clockRateHz: num(codecReport?.clockRate),
      channels: num(codecReport?.channels),
    };
  }
  return null;
}
