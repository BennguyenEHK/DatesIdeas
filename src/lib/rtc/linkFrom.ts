import type { Topology, TrafficRates } from "./diagnostics";
import type { LinkSnapshot } from "./linkSnapshot";
import type { RemoteAudioHealth } from "./remoteAudio";

/**
 * Assembles a LinkSnapshot from whatever the last stats poll left behind.
 *
 * Every input may be null -- before the first poll, after a connection is
 * dropped, or on a browser that reports less -- and each missing input leaves
 * its fields null rather than guessed, so a caller pacing a transfer never
 * mistakes "not measured yet" for "plenty of room".
 */
export function linkFrom(
  topology: Topology | null,
  rates: TrafficRates | null,
  audioJitterMs: number | null,
  remote: RemoteAudioHealth | null,
): LinkSnapshot {
  return {
    outgoingKbps: topology?.availableOutgoingKbps ?? null,
    audioJitterMs,
    audioLossPct: rates?.audioLossPct ?? null,
    theirJitterMs: remote?.jitterMs ?? null,
    theirLossPct: remote?.lossPct ?? null,
    relayed: topology?.relayed ?? null,
  };
}
