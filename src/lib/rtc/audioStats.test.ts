import { describe, it, expect } from "vitest";
import {
  readAudio,
  audioJitterMs,
  audioBitrateKbps,
  readAudioFormat,
} from "./audioStats";
import type { AudioSample } from "./audioStats";
import type { StatsLike } from "./path";

const makeStats = (entries: Record<string, Record<string, unknown>>) =>
  new Map(Object.entries(entries)) as unknown as StatsLike;

describe("readAudio", () => {
  it("reads the cumulative counters and timestamp off inbound audio", () => {
    const stats = makeStats({
      a: {
        type: "inbound-rtp",
        kind: "audio",
        jitterBufferDelay: 1.6,
        jitterBufferEmittedCount: 150,
        bytesReceived: 12000,
        timestamp: 4200,
      },
    });
    expect(readAudio(stats)).toEqual({
      delaySeconds: 1.6,
      emitted: 150,
      bytes: 12000,
      atMs: 4200,
    });
  });

  it("returns null when no audio is arriving", () => {
    expect(readAudio(makeStats({}))).toBeNull();
  });

  it("returns null when an audio field is missing", () => {
    expect(
      readAudio(
        makeStats({
          a: { type: "inbound-rtp", kind: "audio", bytesReceived: 10 },
        }),
      ),
    ).toBeNull();
  });
});

describe("readAudioFormat", () => {
  it("reads a healthy negotiated opus format", () => {
    const stats = makeStats({
      a: { type: "inbound-rtp", kind: "audio", codecId: "c" },
      c: { type: "codec", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    });
    expect(readAudioFormat(stats)).toEqual({
      codec: "opus",
      clockRateHz: 48000,
      channels: 2,
    });
  });

  it("makes a narrowband mono negotiation visible", () => {
    const stats = makeStats({
      a: { type: "inbound-rtp", kind: "audio", codecId: "c" },
      c: { type: "codec", mimeType: "audio/PCMU", clockRate: 16000, channels: 1 },
    });
    expect(readAudioFormat(stats)).toEqual({
      codec: "pcmu",
      clockRateHz: 16000,
      channels: 1,
    });
  });

  it("returns null when the codecId resolves to nothing", () => {
    expect(
      readAudioFormat(
        makeStats({ a: { type: "inbound-rtp", kind: "audio", codecId: "missing" } }),
      ),
    ).toBeNull();
  });
});

describe("audioJitterMs", () => {
  const sample = (delaySeconds: number, emitted: number): AudioSample => ({
    delaySeconds,
    emitted,
    bytes: 0,
    atMs: 0,
  });

  it("uses the lifetime average without a previous sample", () => {
    expect(audioJitterMs(null, sample(1.6, 150))).toBeCloseTo(10.667, 2);
  });

  it("falls back to lifetime average when counters go backwards", () => {
    expect(audioJitterMs(sample(9, 900), sample(0.2, 20))).toBeCloseTo(10, 5);
  });

  it("returns null when no new samples have arrived", () => {
    const s = sample(1, 100);
    expect(audioJitterMs(s, s)).toBeNull();
  });
});

describe("audioBitrateKbps", () => {
  it("returns null for a sub-500ms window", () => {
    const prev = { delaySeconds: 0, emitted: 1, bytes: 1000, atMs: 1000 };
    const cur = { ...prev, bytes: 2000, atMs: 1499 };
    expect(audioBitrateKbps(prev, cur)).toBeNull();
  });
});
