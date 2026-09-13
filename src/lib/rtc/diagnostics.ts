import { RELAY_SLOW_RTT_MS } from "./path";
import type { StatsLike } from "./path";

export interface CandidateGathering {
  /** Sorted unique local candidate types seen in the stats: "host" | "srflx" | "relay". */
  types: string[];
  /** True when a server-reflexive candidate exists, i.e. STUN discovered our public address. */
  hasReflexive: boolean;
  /** True when a relay candidate was gathered at all. */
  hasRelay: boolean;
  /** Sorted unique relayProtocol values across all gathered relay candidates. */
  relayProtocols: string[];
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

/**
 * What the microphone actually became, and what it has actually delivered.
 *
 * Present because "the mic went broke on the high notes" has at least four
 * possible causes needing opposite fixes, and reading the code cannot choose
 * between them. These fields can, from one evening of real singing.
 */
export interface MicReport {
  /** The settled processing chain, as a phrase. */
  description: string;
  /** Requested processing flags the device did not adopt. */
  unmet: readonly string[];
  /** Why the device refused the constraints, or null when it did not. */
  error: string | null;
  /**
   * Which physical microphone this is, or "unknown".
   *
   * Everything else in this block describes how a device was configured. None
   * of it can tell you the browser opened the laptop's own microphone instead
   * of the headset plugged into it, and that is a completely different problem
   * from a profile being refused.
   */
  device: string;
  /** The running input-level picture. */
  level: string;
  /** How many times a clear voice collapsed straight into silence. */
  dropouts: number;
  /** The operating system's own voice isolation, where the browser reports it. */
  voiceIsolation: boolean | null;
}

export interface ReportInput {
  topology: Topology | null;
  rates: TrafficRates | null;
  sample: TrafficSample | null;
  /** The IceResult.degraded string, or null when TURN answered normally. */
  degraded: string | null;
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
  /**
   * readyState of each data channel, or null when it was never created.
   *
   * Here because a karaoke song crosses on `files` while every control message
   * crosses on `sync`, so the two can fail independently -- and when they do,
   * the symptom is that the other person's buttons work perfectly and their
   * screen stays empty. Without these two lines that state is invisible from
   * both sides at once.
   */
  syncChannel: string | null;
  fileChannel: string | null;
  /** The microphone, or null when karaoke was never opened. */
  mic: MicReport | null;
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
  const relayProtocols = new Set<string>();
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
      if (type === "relay") {
        const relayProtocol = str(report.relayProtocol);
        if (relayProtocol !== null) relayProtocols.add(relayProtocol);
      }
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
    // Read from the candidate, not the pair. RTCIceCandidatePairStats has no
    // protocol field at all, so asking the pair for one always answered null --
    // which is why a healthy direct UDP route described its transport as
    // "unknown" and looked like a gap in the measurement rather than a bug.
    protocol: str(local?.protocol) ?? str(chosen.protocol),
    relayProtocol: localType === "relay" ? str(local?.relayProtocol) : null,
    availableOutgoingKbps: outgoing === null ? null : outgoing / 1000,
    gathering: {
      types: [...types].sort(),
      hasReflexive: types.has("srflx"),
      hasRelay: types.has("relay"),
      relayProtocols: [...relayProtocols].sort(),
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
    `Relay transports gathered: ${topology === null ? "unknown" : topology.gathering.relayProtocols.join(", ") || "unknown"}`,
    `TURN credentials: ${input.degraded === null ? "ok" : `degraded (${input.degraded})`}`,
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
    `Activity: ${input.activity === null ? "none" : text(input.activity)}`,
    `Connected for: ${duration(input.connectedForMs)}`,
    "CHANNELS",
    `Sync channel: ${text(input.syncChannel)}`,
    `File channel: ${text(input.fileChannel)}`,
    "MICROPHONE",
    `Device: ${input.mic === null ? "not opened" : input.mic.device}`,
    `Settled as: ${input.mic === null ? "not opened" : input.mic.description}`,
    `Requested but refused: ${
      input.mic === null || input.mic.unmet.length === 0
        ? "nothing"
        : input.mic.unmet.join(", ")
    }`,
    `Constraint error: ${input.mic?.error ?? "none"}`,
    `Input level: ${input.mic === null ? "not opened" : input.mic.level}`,
  ];

  if (topology === null) lines.push("VERDICT: no route selected yet.");
  else if (!topology.relayed) lines.push("VERDICT: direct.");
  else if (input.netRttMs !== null && input.netRttMs > RELAY_SLOW_RTT_MS) lines.push("VERDICT: relayed and slow - the long round trip may be caused by a distant relay or a distant other person.");
  else if (input.netRttMs !== null) lines.push("VERDICT: relayed but close - the relay is not the problem.");
  else lines.push("VERDICT: relayed.");

  if (topology !== null && !topology.gathering.hasReflexive) {
    lines.push("NOTE: no reflexive candidate - this network hid our public address, so a direct connection was never possible.");
  }
  const heldBack =
    rates?.audioLossPct !== null &&
    rates?.audioLossPct !== undefined &&
    rates.audioLossPct < 1.0 &&
    input.audioJitterMs !== null &&
    input.audioJitterMs > 400;
  // Only a relay can hold packets back and deliver them in order. Saying this
  // about a direct route sent us hunting a TCP relay that was not there.
  if (heldBack && topology?.relayed === true) {
    lines.push("NOTE: heavy delay with almost no packet loss means packets are being held and reordered rather than dropped - a signature of a TCP-based relay, not a congested network.");
  } else if (heldBack) {
    lines.push("NOTE: heavy delay with almost no packet loss on a DIRECT route - nothing is dropping the audio, so it is being buffered. Either the path briefly stalled or the receiver is holding more than it needs.");
  }
  // The three microphone findings, each of which points somewhere different.
  if (input.mic !== null && input.mic.unmet.length > 0) {
    lines.push(
      `NOTE: the microphone REFUSED ${input.mic.unmet.join(", ")} - the singing profile was asked for and did not take, so this microphone is still running the processing meant for speech. That processing is built to remove a sustained tone.`,
    );
  }
  if (input.mic?.voiceIsolation === true) {
    lines.push(
      "NOTE: the operating system's own voice isolation is switched on. It sits below every setting this app can reach, and it is built to keep a talking voice and discard everything else - which includes a held sung note.",
    );
  }
  if (input.mic !== null && input.mic.dropouts > 0) {
    lines.push(
      `NOTE: the microphone delivered nothing at all on ${input.mic.dropouts} occasion(s) while someone was clearly singing. This is measured before the encoder, so the signal was already gone at capture and nothing about the codec or the network can explain it.`,
    );
  }
  // The exact shape of "their controls work but the song never arrives", called
  // out by name so nobody has to know that songs and buttons travel separately.
  if (input.syncChannel === "open" && input.fileChannel !== "open") {
    lines.push(
      `NOTE: control messages can cross but files cannot (file channel: ${text(input.fileChannel)}) - a song loaded here would never reach them.`,
    );
  }
  return lines.join("\n");
}
