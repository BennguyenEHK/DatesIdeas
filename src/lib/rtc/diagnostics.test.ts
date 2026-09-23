import { describe, expect, it } from "vitest";
import { formatReport, readTopology, readTraffic, trafficRates } from "./diagnostics";
import type { ReportInput, TrafficSample } from "./diagnostics";
import { RELAY_SLOW_RTT_MS } from "./path";
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
  it("scans every local candidate for gathering evidence", () => expect(readTopology(makeStats({ ...base, stun: { type: "local-candidate", candidateType: "srflx" }, host: { type: "local-candidate", candidateType: "host" } }))?.gathering).toEqual({ types: ["host", "relay", "srflx"], hasReflexive: true, hasRelay: true, relayProtocols: ["tls"] }));
  it("records every unique relay transport gathered", () => expect(readTopology(makeStats({ ...base, tcpRelay: { type: "local-candidate", candidateType: "relay", relayProtocol: "tcp" }, udpRelay: { type: "local-candidate", candidateType: "relay", relayProtocol: "udp" }, secondTcpRelay: { type: "local-candidate", candidateType: "relay", relayProtocol: "tcp" } }))?.gathering.relayProtocols).toEqual(["tcp", "tls", "udp"]));
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
  const empty: ReportInput = { topology: null, rates: null, sample: null, degraded: null, netRttMs: null, pingRttMs: null, audioJitterMs: null, videoJitterMs: null, audioCodec: null, activity: null, connectedForMs: null, syncChannel: null, fileChannel: null, mic: null };
  it("never throws when every field is null", () => expect(() => formatReport(empty)).not.toThrow());
  it("prints unknown rather than null for absent data", () => expect(formatReport(empty)).toContain("ICE RTT: unknown"));
  it("explains that no selected route has no verdict yet", () => expect(formatReport(empty)).toContain("VERDICT: no route selected yet."));
  const relayedTopology = { relayed: true, localType: null, remoteType: null, localAddress: null, remoteAddress: null, protocol: null, relayProtocol: null, availableOutgoingKbps: null, gathering: { types: [], hasReflexive: true, hasRelay: true, relayProtocols: [] }, pairStates: {} };
  it("reports both possible causes of a long relayed round trip", () => expect(formatReport({ ...empty, topology: relayedTopology, netRttMs: RELAY_SLOW_RTT_MS + 1 })).toContain("VERDICT: relayed and slow - the long round trip may be caused by a distant relay or a distant other person."));
  it("reports a close relay verdict", () => expect(formatReport({ ...empty, topology: relayedTopology, netRttMs: RELAY_SLOW_RTT_MS })).toContain("VERDICT: relayed but close - the relay is not the problem."));
  it("reports TURN credentials and gathered relay transports", () => {
    const r = formatReport({ ...empty, degraded: "turn-fetch-failed", topology: { ...relayedTopology, gathering: { ...relayedTopology.gathering, relayProtocols: ["tcp", "udp"] } } });
    expect(r).toContain("TURN credentials: degraded (turn-fetch-failed)");
    expect(r).toContain("Relay transports gathered: tcp, udp");
  });
  it("reports normal TURN credentials and unknown relay transports when none were gathered", () => {
    const r = formatReport({ ...empty, topology: relayedTopology });
    expect(r).toContain("TURN credentials: ok");
    expect(r).toContain("Relay transports gathered: unknown");
  });
  it("reports no activity when no activity is open", () => expect(formatReport(empty)).toContain("Activity: none"));
  const heldBackRates = { videoUpKbps: null, videoDownKbps: null, audioUpKbps: null, audioDownKbps: null, audioLossPct: 0.5 };
  const topologyWith = (relayed: boolean, relayProtocol: string | null = relayed ? "tcp" : null) => ({ relayed, localType: null, remoteType: null, localAddress: null, remoteAddress: null, protocol: null, relayProtocol, availableOutgoingKbps: null, gathering: { types: [], hasReflexive: true, hasRelay: true, relayProtocols: [] }, pairStates: {} });

  it("blames the relay for held and reordered packets, when there is a relay", () => {
    const r = formatReport({ ...empty, topology: topologyWith(true), rates: heldBackRates, audioJitterMs: 401 });
    expect(r).toContain("a signature of a TCP-based relay");
  });

  it("does NOT blame a relay on a direct route", () => {
    // Only a relay can hold packets back and hand them over in order. Saying
    // this about a direct connection sent a real debugging session hunting a
    // TCP relay that was not in the path at all.
    const r = formatReport({ ...empty, topology: topologyWith(false), rates: heldBackRates, audioJitterMs: 401 });
    expect(r).not.toContain("TCP-based relay");
    expect(r).toContain("on a DIRECT route");
  });

  it("does NOT blame a TCP relay when the relay is carried over UDP", () => {
    // The live report that prompted this: "udp / udp", 1390 ms, no loss. A
    // queue on the path, which the TCP note sent us looking in the wrong place for.
    const r = formatReport({ ...empty, topology: topologyWith(true, "udp"), rates: heldBackRates, audioJitterMs: 550 });
    expect(r).not.toContain("TCP-based relay");
    expect(r).toContain("NOTE: heavy delay with almost no packet loss on a UDP relay");
  });

  it("blames a relay reached over TLS as it would TCP", () => {
    const r = formatReport({ ...empty, topology: topologyWith(true, "tls"), rates: heldBackRates, audioJitterMs: 401 });
    expect(r).toContain("a signature of a TCP-based relay");
    expect(r).not.toContain("on a UDP relay");
  });

  it("shows what the other side hears of our voice", () => {
    expect(formatReport({ ...empty, theirAudio: { jitterMs: 12.4, lossPct: 1.25 } })).toContain("Their view of our audio: jitter 12 ms, loss 1.3%");
    expect(formatReport(empty)).toContain("Their view of our audio: jitter unknown, loss unknown");
  });

  it("shows the camera cap taken from the upload estimate", () => {
    expect(formatReport({ ...empty, videoCapKbps: 80 })).toContain("Video cap from upload estimate: 80 kbps");
    expect(formatReport(empty)).toContain("Video cap from upload estimate: unknown");
  });

  it("shows how much of a file is queued on the files channel", () => {
    expect(formatReport({ ...empty, fileBufferedBytes: 1_048_576 })).toContain("File channel buffered: 1024 KB");
    expect(formatReport(empty)).toContain("File channel buffered: 0 KB");
  });

  it("says nothing at all when the delay is ordinary", () => {
    const r = formatReport({ ...empty, topology: topologyWith(true), rates: heldBackRates, audioJitterMs: 100 });
    expect(r).not.toContain("held and reordered");
    expect(r).not.toContain("on a DIRECT route");
  });

  describe("the recovery section", () => {
    const recovery = { restarts: 2, lastRestartReason: "disconnected", sinceLastRestartMs: 95_000, longestGapMs: 14_000 };

    it("prints every restart line", () => {
      const r = formatReport({ ...empty, recovery });
      expect(r).toContain("RECOVERY");
      expect(r).toContain("Restarts: 2");
      expect(r).toContain("Last restart reason: disconnected");
      expect(r).toContain("Time since last restart: 1m 35s");
      expect(r).toContain("Longest gap: 14s");
    });

    it("says so plainly when the call has never restarted", () => {
      const r = formatReport({ ...empty, recovery: { restarts: 0, lastRestartReason: null, sinceLastRestartMs: null, longestGapMs: null } });
      expect(r).toContain("Restarts: 0");
      expect(r).toContain("Last restart reason: none");
      expect(r).toContain("Time since last restart: never");
      expect(r).toContain("Longest gap: none");
    });

    it("prints unknown when no recovery data was supplied", () => {
      const r = formatReport(empty);
      expect(r).toContain("Restarts: unknown");
      expect(r).toContain("Longest gap: unknown");
    });

    it("adds the restart-loop note from the third restart", () => {
      const r = formatReport({ ...empty, recovery: { ...recovery, restarts: 3 } });
      expect(r).toContain("NOTE: the call has restarted 3 times - the route is being torn down and rebuilt; check whether the drops line up with the video budget changes above.");
    });

    it("leaves the note out below three restarts", () => {
      expect(formatReport({ ...empty, recovery })).not.toContain("NOTE: the call has restarted");
      expect(formatReport(empty)).not.toContain("NOTE: the call has restarted");
    });
  });

  describe("the long direct route note", () => {
    const note = "NOTE: a long direct route with heavy audio buffering";

    it("appears on a far direct route with a heavily buffered voice", () => {
      const r = formatReport({ ...empty, topology: topologyWith(false), netRttMs: 292, audioJitterMs: 314 });
      expect(r).toContain(`${note} - the video was probably filling the smaller uplink; the camera is leashed from what the other side hears of our voice, to protect it.`);
    });

    it("stays silent on a close direct route, however buffered", () => {
      expect(formatReport({ ...empty, topology: topologyWith(false), netRttMs: 90, audioJitterMs: 314 })).not.toContain(note);
    });

    it("stays silent on a far direct route whose voice is not buffered", () => {
      expect(formatReport({ ...empty, topology: topologyWith(false), netRttMs: 292, audioJitterMs: 100 })).not.toContain(note);
    });

    it("stays silent on a relayed route, which has its own verdicts", () => {
      expect(formatReport({ ...empty, topology: topologyWith(true), netRttMs: 292, audioJitterMs: 314 })).not.toContain(note);
    });

    it("stays silent when the route is not known", () => {
      expect(formatReport({ ...empty, netRttMs: 292, audioJitterMs: 314 })).not.toContain(note);
    });
  });
  it("adds the no-reflexive note", () => expect(formatReport({ ...empty, topology: { relayed: false, localType: null, remoteType: null, localAddress: null, remoteAddress: null, protocol: null, relayProtocol: null, availableOutgoingKbps: null, gathering: { types: [], hasReflexive: false, hasRelay: false, relayProtocols: [] }, pairStates: {} } })).toContain("NOTE: no reflexive candidate"));
  it("shows both channel states, since a song and a button do not travel together", () => {
    const r = formatReport({ ...empty, syncChannel: "open", fileChannel: "connecting" });
    expect(r).toContain("Sync channel: open");
    expect(r).toContain("File channel: connecting");
  });
  it("THE DIAGNOSIS: names the case where their buttons work and the song never arrives", () => {
    // Exactly what was reported from a real call: K could pause and play M's
    // video, and never saw or heard the song. Control messages cross on `sync`
    // and the song crosses on `files`, so one being open says nothing about the
    // other -- and nothing on either screen used to say so.
    const r = formatReport({ ...empty, syncChannel: "open", fileChannel: "closed" });
    expect(r).toContain("control messages can cross but files cannot");
  });
  it("stays quiet when both channels are open", () => {
    const r = formatReport({ ...empty, syncChannel: "open", fileChannel: "open" });
    expect(r).not.toContain("control messages can cross but files cannot");
  });
});

/**
 * The whole reason the microphone block exists. Each of these three notes
 * points at a different layer, and until one of them fires on a real evening
 * there is no honest way to choose between them.
 */
describe("the microphone findings", () => {
  const base: ReportInput = { topology: null, rates: null, sample: null, degraded: null, netRttMs: null, pingRttMs: null, audioJitterMs: null, videoJitterMs: null, audioCodec: null, activity: null, connectedForMs: null, syncChannel: null, fileChannel: null, mic: null };
  const mic = (over: Partial<NonNullable<ReportInput["mic"]>> = {}) => ({
    description: "aec on, ns off, agc off",
    unmet: [] as readonly string[],
    error: null,
    device: "Headset Microphone (Yeti Nano)",
    level: "peak 0.30",
    dropouts: 0,
    voiceIsolation: null,
    ...over,
  });

  it("says the microphone was never opened when karaoke never ran", () => {
    expect(formatReport(base)).toContain("Settled as: not opened");
    expect(formatReport(base)).toContain("Device: not opened");
  });

  it("names the device, because the settings alone cannot say it picked the wrong one", () => {
    expect(formatReport({ ...base, mic: mic() })).toContain(
      "Device: Headset Microphone (Yeti Nano)",
    );
  });

  it("reports the room detection alongside the input level", () => {
    expect(formatReport({ ...base, mic: mic({ room: "auto, noisy, voice 12 dB above the room" }) })).toContain(
      "Room: auto, noisy, voice 12 dB above the room",
    );
  });

  it("stays quiet when the microphone did exactly as it was told", () => {
    const out = formatReport({ ...base, mic: mic() });
    expect(out).toContain("Requested but refused: nothing");
    expect(out).not.toContain("NOTE: the microphone");
  });

  it("names a refused profile, which points at the constraint layer", () => {
    const out = formatReport({ ...base, mic: mic({ unmet: ["noiseSuppression"] }) });
    expect(out).toContain("Requested but refused: noiseSuppression");
    expect(out).toContain("NOTE: the microphone REFUSED noiseSuppression");
  });

  it("names operating-system voice isolation, which points below the browser", () => {
    expect(formatReport({ ...base, mic: mic({ voiceIsolation: true }) })).toContain(
      "voice isolation is switched on",
    );
  });

  it("rules the codec and the network out when capture itself went silent", () => {
    expect(formatReport({ ...base, mic: mic({ dropouts: 3 }) })).toContain(
      "on 3 occasion(s) while someone was clearly singing",
    );
  });
});
