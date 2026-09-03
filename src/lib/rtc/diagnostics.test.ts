import { describe, expect, it } from "vitest";
import { formatReport, readTopology, readTraffic, trafficRates } from "./diagnostics";
import type { ReportInput, TrafficSample } from "./diagnostics";
import type { StatsLike } from "./path";

const makeStats = (entries: Record<string, Record<string, unknown>>) =>
  new Map(Object.entries(entries)) as unknown as StatsLike;

const sample = (overrides: Partial<TrafficSample> = {}): TrafficSample => ({
  atMs: 1000, videoBytesSent: 100, videoBytesReceived: 100, audioBytesSent: 100,
  audioBytesReceived: 100, audioPacketsReceived: 10, audioPacketsLost: 1,
  videoFramesSent: 1, frameWidth: null, frameHeight: null, ...overrides,
});

describe("readTopology", () => {
  const base = {
    chosen: { type: "candidate-pair", state: "succeeded", localCandidateId: "l", remoteCandidateId: "r", protocol: "udp" },
    l: { type: "local-candidate", candidateType: "relay", address: "203.0.113.1", port: 3478, relayProtocol: "tls" },
    r: { type: "remote-candidate", candidateType: "relay", address: "198.51.100.4", port: 5000 },
  };
  it("prefers the transport selected pair", () => expect(readTopology(makeStats({ ...base, transport: { type: "transport", selectedCandidatePairId: "chosen" }, nominated: { ...base.chosen, localCandidateId: "other", nominated: true }, other: { type: "local-candidate", candidateType: "host" } }))?.localType).toBe("relay"));
  it("then prefers a nominated succeeded pair", () => expect(readTopology(makeStats({ ...base, first: { ...base.chosen, localCandidateId: "host" }, host: { type: "local-candidate", candidateType: "host" }, chosen: { ...base.chosen, nominated: true } }))?.localType).toBe("relay"));
  it("finally uses the first succeeded pair", () => expect(readTopology(makeStats(base))?.relayed).toBe(true));
  it("returns null without a succeeded pair", () => expect(readTopology(makeStats({ p: { type: "candidate-pair", state: "failed" } }))).toBeNull());
  it("counts all pair states", () => expect(readTopology(makeStats({ ...base, f: { type: "candidate-pair", state: "failed" }, w: { type: "candidate-pair", state: "waiting" } }))?.pairStates).toEqual({ succeeded: 1, failed: 1, waiting: 1 }));
  it("formats candidate addresses and bitrate", () => expect(readTopology(makeStats({ ...base, chosen: { ...base.chosen, availableOutgoingBitrate: 2500000 } }))).toMatchObject({ localAddress: "203.0.113.1:3478", remoteAddress: "198.51.100.4:5000", availableOutgoingKbps: 2500 }));
  it("uses null address when a candidate part is absent", () => expect(readTopology(makeStats({ ...base, l: { ...base.l, port: undefined } }))?.localAddress).toBeNull());
  it("scans every local candidate for gathering evidence", () => expect(readTopology(makeStats({ ...base, stun: { type: "local-candidate", candidateType: "srflx" }, host: { type: "local-candidate", candidateType: "host" } }))?.gathering).toEqual({ types: ["host", "relay", "srflx"], hasReflexive: true, hasRelay: true }));
  it("does not claim relay protocol for a direct route", () => expect(readTopology(makeStats({ ...base, l: { ...base.l, candidateType: "host" } }))?.relayProtocol).toBeNull());
  it("does not fall through from a stale selected pair", () => expect(readTopology(makeStats({ ...base, transport: { type: "transport", selectedCandidatePairId: "bad" }, bad: { type: "candidate-pair", state: "failed" } }))).toBeNull());
});

describe("readTraffic", () => {
  it("returns null without RTP reports", () => expect(readTraffic(makeStats({ c: { type: "codec" } }))).toBeNull());
  it("sums simulcast outbound video", () => expect(readTraffic(makeStats({ a: { type: "outbound-rtp", kind: "video", bytesSent: 10, framesSent: 1, timestamp: 2000 }, b: { type: "outbound-rtp", kind: "video", bytesSent: 20, framesSent: 2, timestamp: 2000 } }))).toMatchObject({ videoBytesSent: 30, videoFramesSent: 3 }));
  it("reads inbound counters and dimensions", () => expect(readTraffic(makeStats({ a: { type: "inbound-rtp", kind: "audio", bytesReceived: 20, packetsReceived: 3, packetsLost: 1, timestamp: 2000 }, v: { type: "inbound-rtp", kind: "video", bytesReceived: 30, frameWidth: 1280, frameHeight: 720, timestamp: 2000 } }))).toMatchObject({ audioBytesReceived: 20, videoBytesReceived: 30, frameWidth: 1280, frameHeight: 720 }));
  it("treats missing counters as zero", () => expect(readTraffic(makeStats({ a: { type: "inbound-rtp", kind: "audio", timestamp: 1 } }))).toMatchObject({ audioBytesReceived: 0, audioPacketsLost: 0 }));
});

describe("trafficRates", () => {
  it("returns all null without a previous sample", () => expect(trafficRates(null, sample())).toEqual({ videoUpKbps: null, videoDownKbps: null, audioUpKbps: null, audioDownKbps: null, audioLossPct: null }));
  it("rejects a sub-500ms window", () => expect(trafficRates(sample(), sample({ atMs: 1499 }))).toEqual({ videoUpKbps: null, videoDownKbps: null, audioUpKbps: null, audioDownKbps: null, audioLossPct: null }));
  it("calculates byte rates at 500ms", () => expect(trafficRates(sample(), sample({ atMs: 1500, videoBytesSent: 1100, audioBytesReceived: 600 }))).toMatchObject({ videoUpKbps: 16, audioDownKbps: 8 }));
  it("returns null for restarted byte counters", () => expect(trafficRates(sample(), sample({ atMs: 2000, videoBytesSent: 10 }))).toMatchObject({ videoUpKbps: null }));
  it("allows a zero byte delta as a zero rate", () => expect(trafficRates(sample(), sample({ atMs: 2000 }))).toMatchObject({ videoUpKbps: 0 }));
  it("uses only the window for audio loss", () => expect(trafficRates(sample({ audioPacketsReceived: 100, audioPacketsLost: 50 }), sample({ atMs: 2000, audioPacketsReceived: 110, audioPacketsLost: 51 }))).toMatchObject({ audioLossPct: (1 / 11) * 100 }));
  it("returns null loss when no packets changed", () => expect(trafficRates(sample(), sample({ atMs: 2000 }))).toMatchObject({ audioLossPct: null }));
  it("returns null loss when packet counters restarted", () => expect(trafficRates(sample(), sample({ atMs: 2000, audioPacketsLost: 0 }))).toMatchObject({ audioLossPct: null }));
});

describe("formatReport", () => {
  const empty: ReportInput = { topology: null, rates: null, sample: null, netRttMs: null, pingRttMs: null, audioJitterMs: null, videoJitterMs: null, audioCodec: null, activity: null, connectedForMs: null };
  it("never throws when every field is null", () => expect(() => formatReport(empty)).not.toThrow());
  it("prints unknown rather than null for absent data", () => expect(formatReport(empty)).toContain("ICE RTT: unknown"));
  it("explains that no selected route has no verdict yet", () => expect(formatReport(empty)).toContain("VERDICT: no route selected yet."));
  it("reports a slow relay verdict", () => expect(formatReport({ ...empty, topology: { relayed: true, localType: null, remoteType: null, localAddress: null, remoteAddress: null, protocol: null, relayProtocol: null, availableOutgoingKbps: null, gathering: { types: [], hasReflexive: true, hasRelay: true }, pairStates: {} }, netRttMs: 151 })).toContain("VERDICT: relayed and slow - the relay may be far away."));
  it("reports a close relay verdict", () => expect(formatReport({ ...empty, topology: { relayed: true, localType: null, remoteType: null, localAddress: null, remoteAddress: null, protocol: null, relayProtocol: null, availableOutgoingKbps: null, gathering: { types: [], hasReflexive: true, hasRelay: true }, pairStates: {} }, netRttMs: 150 })).toContain("VERDICT: relayed but close - the relay is not the problem."));
  it("adds the no-reflexive note", () => expect(formatReport({ ...empty, topology: { relayed: false, localType: null, remoteType: null, localAddress: null, remoteAddress: null, protocol: null, relayProtocol: null, availableOutgoingKbps: null, gathering: { types: [], hasReflexive: false, hasRelay: false }, pairStates: {} } })).toContain("NOTE: no reflexive candidate"));
});
