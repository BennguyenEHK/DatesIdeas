import { describe, expect, it } from "vitest";
import type { StatsLike } from "./path";
import {
  readRemoteAudio,
  remoteAudioHasAdvanced,
  remoteAudioHealth,
  remoteAudioIsStale,
  type RemoteAudioSample,
} from "./remoteAudio";

const makeStats = (entries: Record<string, Record<string, unknown>>) =>
  new Map(Object.entries(entries)) as unknown as StatsLike;

const sample = (
  overrides: Partial<RemoteAudioSample> = {},
): RemoteAudioSample => ({
  timestampMs: 1000,
  jitterMs: 10,
  fractionLostPct: null,
  packetsLost: 0,
  packetsSent: 0,
  ...overrides,
});

describe("readRemoteAudio", () => {
  it("reads the receiver report about our audio", () => {
    const stats = makeStats({
      r: {
        type: "remote-inbound-rtp",
        kind: "audio",
        jitter: 0.042,
        timestamp: 12_345,
        fractionLost: 0.053,
        packetsLost: 12,
      },
      o: { type: "outbound-rtp", kind: "audio", packetsSent: 900 },
    });
    const read = readRemoteAudio(stats);
    expect(read).not.toBeNull();
    expect(read?.jitterMs).toBeCloseTo(42);
    expect(read?.timestampMs).toBe(12_345);
    expect(read?.fractionLostPct).toBeCloseTo(5.3);
    expect(read?.packetsLost).toBe(12);
    expect(read?.packetsSent).toBe(900);
  });

  it("returns null when no receiver report about audio exists", () => {
    const stats = makeStats({
      v: { type: "remote-inbound-rtp", kind: "video", jitter: 0.01 },
      i: { type: "inbound-rtp", kind: "audio", jitterBufferDelay: 1 },
    });
    expect(readRemoteAudio(stats)).toBeNull();
  });

  it("leaves fields the browser omitted as null", () => {
    const read = readRemoteAudio(
      makeStats({ r: { type: "remote-inbound-rtp", kind: "audio" } }),
    );
    expect(read).toEqual({
      timestampMs: null,
      jitterMs: null,
      fractionLostPct: null,
      packetsLost: null,
      packetsSent: null,
    });
  });
});

describe("remoteAudioIsStale", () => {
  it("marks an unchanged receiver report as stale", () => {
    const prev = sample({ timestampMs: 1_000, packetsSent: 100 });
    const cur = sample({ timestampMs: 1_000, packetsSent: 100 });
    expect(remoteAudioIsStale(prev, cur)).toBe(true);
  });

  it("keeps a newly arrived report fresh until there is a prior poll", () => {
    expect(remoteAudioIsStale(null, sample())).toBe(false);
  });

  it("uses advancing packet counters when timestamps are unavailable", () => {
    const prev = sample({ timestampMs: null, packetsSent: 100 });
    const cur = sample({ timestampMs: null, packetsSent: 101 });
    expect(remoteAudioHasAdvanced(prev, cur)).toBe(true);
  });
});

describe("remoteAudioHealth", () => {
  it("uses the reported interval loss as it stands", () => {
    const health = remoteAudioHealth(null, sample({ fractionLostPct: 5.3 }));
    expect(health).toEqual({ jitterMs: 10, lossPct: 5.3 });
  });

  it("derives a window loss from the counters when no fraction is reported", () => {
    const prev = sample({ packetsLost: 10, packetsSent: 1000 });
    const cur = sample({ packetsLost: 13, packetsSent: 1150 });
    expect(remoteAudioHealth(prev, cur).lossPct).toBeCloseTo(2);
  });

  it("has no loss figure on the first report without a fraction", () => {
    expect(remoteAudioHealth(null, sample()).lossPct).toBeNull();
  });

  it("refuses a window across restarted counters", () => {
    const prev = sample({ packetsLost: 50, packetsSent: 5000 });
    const cur = sample({ packetsLost: 1, packetsSent: 100 });
    expect(remoteAudioHealth(prev, cur).lossPct).toBeNull();
  });

  it("has no loss figure when nothing was sent in the window", () => {
    const prev = sample({ packetsLost: 5, packetsSent: 500 });
    expect(remoteAudioHealth(prev, { ...prev }).lossPct).toBeNull();
  });
});
