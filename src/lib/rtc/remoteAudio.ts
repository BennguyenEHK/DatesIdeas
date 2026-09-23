import type { StatsLike } from "./path";

/**
 * What the other side reports about the voice WE send, from one getStats().
 *
 * This is the RTCP receiver report, surfaced as "remote-inbound-rtp". It is
 * the only measurement that describes our own uplink: everything under
 * "inbound-rtp" describes the other person's uplink and our downlink instead,
 * so leashing our camera from it punishes the side that is not causing the
 * problem and leaves the side that is untouched.
 */
export interface RemoteAudioSample {
  /** RTP interarrival jitter at their end, ms. */
  jitterMs: number | null;
  /** Loss over the last report interval, percent 0-100, when reported. */
  fractionLostPct: number | null;
  /** Cumulative packets they never received. */
  packetsLost: number | null;
  /** Cumulative audio packets we have sent, for deriving a window loss. */
  packetsSent: number | null;
}

/** Their view of our voice over the last poll window. */
export interface RemoteAudioHealth {
  jitterMs: number | null;
  lossPct: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Reads the receiver report about our audio, or null when the browser has not
 * produced one -- older builds, or the first second of a call before any
 * RTCP has come back. Null is what tells the caller to fall back to the
 * inbound numbers rather than treat the voice as healthy.
 */
export function readRemoteAudio(stats: StatsLike): RemoteAudioSample | null {
  let remote: Record<string, unknown> | null = null;
  let packetsSent: number | null = null;
  for (const report of stats.values()) {
    if (report.kind !== "audio") continue;
    if (report.type === "remote-inbound-rtp" && remote === null) {
      remote = report;
    }
    if (report.type === "outbound-rtp" && packetsSent === null) {
      packetsSent = num(report.packetsSent);
    }
  }
  if (remote === null) return null;

  const jitterSeconds = num(remote.jitter);
  const fraction = num(remote.fractionLost);
  return {
    jitterMs: jitterSeconds === null ? null : jitterSeconds * 1000,
    fractionLostPct: fraction === null ? null : fraction * 100,
    packetsLost: num(remote.packetsLost),
    packetsSent,
  };
}

/**
 * Turns two receiver reports into the voice's health over the window between
 * them.
 *
 * fractionLost is already a window figure -- the last RTCP interval -- so it
 * is used as it stands. Only when a browser omits it is the loss derived from
 * the cumulative counters, because a lifetime loss figure hides a link that
 * has just started choking behind an hour of clean audio.
 */
export function remoteAudioHealth(
  prev: RemoteAudioSample | null,
  cur: RemoteAudioSample,
): RemoteAudioHealth {
  return { jitterMs: cur.jitterMs, lossPct: windowLoss(prev, cur) };
}

function windowLoss(
  prev: RemoteAudioSample | null,
  cur: RemoteAudioSample,
): number | null {
  if (cur.fractionLostPct !== null) return cur.fractionLostPct;
  if (
    prev === null ||
    prev.packetsLost === null ||
    prev.packetsSent === null ||
    cur.packetsLost === null ||
    cur.packetsSent === null
  ) {
    return null;
  }
  const lost = cur.packetsLost - prev.packetsLost;
  const sent = cur.packetsSent - prev.packetsSent;
  // Counters restart on an ICE restart; a negative window is not a reading.
  if (lost < 0 || sent <= 0) return null;
  return Math.min(100, (lost / sent) * 100);
}
