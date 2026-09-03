import type { StatsLike } from "./path";

export interface CandidateGathering {
  /** Sorted unique local candidate types seen in the stats: "host" | "srflx" | "relay". */
  types: string[];
  /** True when a server-reflexive candidate exists, i.e. STUN discovered our public address. */
  hasReflexive: boolean;
  /** True when a relay candidate was gathered at all. */
  hasRelay: boolean;
}

export interface Topology {
  relayed: boolean;
  localType: string | null;
  remoteType: string | null;
  /** ip:port of each end of the selected pair, so the relay can be geolocated. */
  localAddress: string | null;
  remoteAddress: string | null;
  /** Transport of the selected pair: "udp" | "tcp". */
  protocol: string | null;
  /** How the relay itself is reached: "udp" | "tcp" | "tls". Null when not relayed. */
  relayProtocol: string | null;
  /** The browser's own estimate of how much room the path has, in kbps. */
  availableOutgoingKbps: number | null;
  gathering: CandidateGathering;
  /** How many candidate pairs reached each state, e.g. { succeeded: 1, failed: 7 }. */
  pairStates: Record<string, number>;
}

export interface TrafficSample {
  atMs: number;
  videoBytesSent: number;
  videoBytesReceived: number;
  audioBytesSent: number;
  audioBytesReceived: number;
  audioPacketsReceived: number;
  audioPacketsLost: number;
  /** Sum over outbound video reports; 0 when not sending video. */
  videoFramesSent: number;
  /** From the inbound video report, or null. */
  frameWidth: number | null;
  frameHeight: number | null;
}

export interface TrafficRates {
  videoUpKbps: number | null;
  videoDownKbps: number | null;
  audioUpKbps: number | null;
  audioDownKbps: number | null;
  /** Percentage 0-100, or null when no packets arrived in the window. */
  audioLossPct: number | null;
}

export interface ReportInput {
  topology: Topology | null;
  rates: TrafficRates | null;
  sample: TrafficSample | null;
  /** ICE-layer round trip, ms. Measured below JavaScript. */
  netRttMs: number | null;
  /** DataChannel ping round trip, ms. Travels through JavaScript. */
  pingRttMs: number | null;
  audioJitterMs: number | null;
  videoJitterMs: number | null;
  audioCodec: string | null;
  /** e.g. "karaoke", or null when no activity is open. */
  activity: string | null;
  /** How long the call has been connected, ms. */
  connectedForMs: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

const address = (candidate: Record<string, unknown> | undefined): string | null => {
  const host = str(candidate?.address);
  const port = num(candidate?.port);
  return host !== null && port !== null ? `${host}:${port}` : null;
};

/**
 * Reads the nominated ICE route alongside all routes the local machine found.
 *
 * Gathering is intentionally independent of selection: a relay may carry this
 * call even when STUN successfully found a public address worth reporting.
 */
export function readTopology(stats: StatsLike): Topology | null {
  const pairs: Record<string, unknown>[] = [];
  const types = new Set<string>();
  const pairStates: Record<string, number> = {};
  let selectedId: string | null = null;

  for (const report of stats.values()) {
    if (report.type === "candidate-pair") {
      pairs.push(report);
      const state = str(report.state);
      if (state !== null) pairStates[state] = (pairStates[state] ?? 0) + 1;
    } else if (report.type === "transport" && selectedId === null) {
      selectedId = str(report.selectedCandidatePairId);
    }

    if (report.type === "local-candidate") {
      const type = str(report.candidateType);
      if (type !== null) types.add(type);
    }
  }

  const succeeded = pairs.filter((pair) => pair.state === "succeeded");
  const chosen =
    (selectedId !== null ? stats.get(selectedId) : undefined) ??
    succeeded.find((pair) => pair.nominated === true) ??
    succeeded[0];

  // A transport can retain a stale selected ID during an ICE restart. It must
  // not be presented as a route merely because another pair later succeeded.
  if (!chosen || chosen.state !== "succeeded") return null;

  const localId = str(chosen.localCandidateId);
  const remoteId = str(chosen.remoteCandidateId);
  const local = localId !== null ? stats.get(localId) : undefined;
  const remote = remoteId !== null ? stats.get(remoteId) : undefined;
  const localType = str(local?.candidateType);
  const outgoing = num(chosen.availableOutgoingBitrate);

  return {
    relayed: localType === "relay",
    localType,
    remoteType: str(remote?.candidateType),
    localAddress: address(local),
    remoteAddress: address(remote),
    protocol: str(chosen.protocol),
    relayProtocol: localType === "relay" ? str(local?.relayProtocol) : null,
    availableOutgoingKbps: outgoing === null ? null : outgoing / 1000,
    gathering: {
      types: [...types].sort(),
      hasReflexive: types.has("srflx"),
      hasRelay: types.has("relay"),
    },
    pairStates,
  };
}

/**
 * Reads cumulative RTP counters from every stream, because simulcast splits
 * one visible video call into several outbound reports.
 */
export function readTraffic(stats: StatsLike): TrafficSample | null {
  let found = false;
  let atMs: number | null = null;
  let videoBytesSent = 0;
  let videoBytesReceived = 0;
  let audioBytesSent = 0;
  let audioBytesReceived = 0;
  let audioPacketsReceived = 0;
  let audioPacketsLost = 0;
  let videoFramesSent = 0;
  let frameWidth: number | null = null;
  let frameHeight: number | null = null;

  for (const report of stats.values()) {
    const inbound = report.type === "inbound-rtp";
    const outbound = report.type === "outbound-rtp";
    if (!inbound && !outbound) continue;
    found = true;
    if (atMs === null) atMs = num(report.timestamp);

    if (report.kind === "video") {
      if (outbound) {
        videoBytesSent += num(report.bytesSent) ?? 0;
        videoFramesSent += num(report.framesSent) ?? 0;
      } else {
        videoBytesReceived += num(report.bytesReceived) ?? 0;
        if (frameWidth === null) frameWidth = num(report.frameWidth);
        if (frameHeight === null) frameHeight = num(report.frameHeight);
      }
    } else if (report.kind === "audio") {
      if (outbound) audioBytesSent += num(report.bytesSent) ?? 0;
      else {
        audioBytesReceived += num(report.bytesReceived) ?? 0;
        audioPacketsReceived += num(report.packetsReceived) ?? 0;
        audioPacketsLost += num(report.packetsLost) ?? 0;
      }
    }
  }

  if (!found) return null;
  return { atMs: atMs ?? 0, videoBytesSent, videoBytesReceived, audioBytesSent, audioBytesReceived, audioPacketsReceived, audioPacketsLost, videoFramesSent, frameWidth, frameHeight };
}

const rate = (previous: number, current: number, elapsedMs: number): number | null => {
  const delta = current - previous;
  return delta < 0 ? null : (delta * 8) / elapsedMs;
};

/**
 * Converts cumulative RTP totals into recent rates, rejecting a poll interval
 * too short to distinguish congestion from normal packet batching.
 */
export function trafficRates(prev: TrafficSample | null, cur: TrafficSample): TrafficRates {
  const unknown: TrafficRates = { videoUpKbps: null, videoDownKbps: null, audioUpKbps: null, audioDownKbps: null, audioLossPct: null };
  if (prev === null) return unknown;

  const elapsedMs = cur.atMs - prev.atMs;
  if (elapsedMs < 500 || elapsedMs <= 0) return unknown;

  const received = cur.audioPacketsReceived - prev.audioPacketsReceived;
  const lost = cur.audioPacketsLost - prev.audioPacketsLost;
  const denominator = received + lost;
  return {
    videoUpKbps: rate(prev.videoBytesSent, cur.videoBytesSent, elapsedMs),
    videoDownKbps: rate(prev.videoBytesReceived, cur.videoBytesReceived, elapsedMs),
    audioUpKbps: rate(prev.audioBytesSent, cur.audioBytesSent, elapsedMs),
    audioDownKbps: rate(prev.audioBytesReceived, cur.audioBytesReceived, elapsedMs),
    // Loss is a window measurement; lifetime loss hides a newly congested link.
    audioLossPct: received < 0 || lost < 0 || denominator <= 0 ? null : (lost / denominator) * 100,
  };
}

const text = (value: string | null): string => value ?? "unknown";
const whole = (value: number | null, suffix: string): string =>
  value === null || !Number.isFinite(value) ? "unknown" : `${Math.round(value)} ${suffix}`;
const loss = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? "unknown" : `${value.toFixed(1)}%`;

/**
 * A call runs for tens of minutes, and this report is read by a person rather
 * than a machine. "2400000 ms" is technically the answer and practically not
 * one.
 */
const duration = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
};

/** "1280x720", or unknown when the browser has not reported a frame yet. */
const frameSize = (sample: TrafficSample | null): string => {
  const w = sample?.frameWidth ?? null;
  const h = sample?.frameHeight ?? null;
  if (w === null || h === null) return "unknown";
  return `${Math.round(w)}x${Math.round(h)}`;
};

/** Formats a fixed, pasteable summary so an incomplete stats snapshot is still useful. */
export function formatReport(input: ReportInput): string {
  const topology = input.topology;
  const rates = input.rates;
  const sample = input.sample;
  const lines = [
    "PATH",
    `Route: ${topology === null ? "unknown" : topology.relayed ? "relayed" : "direct"}`,
    `Candidate types: ${text(topology?.localType ?? null)} / ${text(topology?.remoteType ?? null)}`,
    `Local address: ${text(topology?.localAddress ?? null)}`,
    `Remote address: ${text(topology?.remoteAddress ?? null)}`,
    `Transport / relay protocol: ${text(topology?.protocol ?? null)} / ${text(topology?.relayProtocol ?? null)}`,
    `Outgoing headroom: ${whole(topology?.availableOutgoingKbps ?? null, "kbps")}`,
    "GATHERING",
    `Candidate types: ${topology === null ? "unknown" : topology.gathering.types.join(", ") || "unknown"}`,
    `Reflexive candidate: ${topology === null ? "unknown" : topology.gathering.hasReflexive ? "yes" : "no"}`,
    `Relay candidate: ${topology === null ? "unknown" : topology.gathering.hasRelay ? "yes" : "no"}`,
    `Pair states: ${topology === null ? "unknown" : Object.entries(topology.pairStates).map(([state, count]) => `${state}: ${count}`).join(", ") || "unknown"}`,
    "TRAFFIC",
    `Video up/down: ${whole(rates?.videoUpKbps ?? null, "kbps")} / ${whole(rates?.videoDownKbps ?? null, "kbps")}`,
    `Audio up/down: ${whole(rates?.audioUpKbps ?? null, "kbps")} / ${whole(rates?.audioDownKbps ?? null, "kbps")}`,
    `Audio loss: ${loss(rates?.audioLossPct ?? null)}`,
    `Video size: ${frameSize(sample)}`,
    "DELAY",
    `ICE RTT: ${whole(input.netRttMs, "ms")}`,
    `DataChannel ping: ${whole(input.pingRttMs, "ms")}`,
    `Audio jitter: ${whole(input.audioJitterMs, "ms")}`,
    `Video jitter: ${whole(input.videoJitterMs, "ms")}`,
    `Audio codec: ${text(input.audioCodec)}`,
    `Activity: ${text(input.activity)}`,
    `Connected for: ${duration(input.connectedForMs)}`,
  ];

  if (topology === null) lines.push("VERDICT: no route selected yet.");
  else if (!topology.relayed) lines.push("VERDICT: direct.");
  else if (input.netRttMs !== null && input.netRttMs > 150) lines.push("VERDICT: relayed and slow - the relay may be far away.");
  else if (input.netRttMs !== null) lines.push("VERDICT: relayed but close - the relay is not the problem.");
  else lines.push("VERDICT: relayed.");

  if (topology !== null && !topology.gathering.hasReflexive) {
    lines.push("NOTE: no reflexive candidate - this network hid our public address, so a direct connection was never possible.");
  }
  return lines.join("\n");
}
