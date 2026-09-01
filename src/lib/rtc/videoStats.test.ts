import { describe, it, expect } from "vitest";
import { readJitter, jitterDelayMs } from "./videoStats";
import type { StatsLike } from "./path";

const makeStats = (entries: Record<string, Record<string, unknown>>) =>
  new Map(Object.entries(entries)) as unknown as StatsLike;

describe("readJitter", () => {
  it("reads the cumulative counters off the inbound video stream", () => {
    const stats = makeStats({
      v: {
        type: "inbound-rtp",
        kind: "video",
        jitterBufferDelay: 1.6,
        jitterBufferEmittedCount: 150,
      },
    });
    expect(readJitter(stats)).toEqual({ delaySeconds: 1.6, frames: 150 });
  });

  it("ignores the audio stream", () => {
    // Audio has its own buffer with different behaviour; mixing them would
    // report a number that describes neither.
    const stats = makeStats({
      a: {
        type: "inbound-rtp",
        kind: "audio",
        jitterBufferDelay: 9.9,
        jitterBufferEmittedCount: 900,
      },
      v: {
        type: "inbound-rtp",
        kind: "video",
        jitterBufferDelay: 1.0,
        jitterBufferEmittedCount: 100,
      },
    });
    expect(readJitter(stats)?.delaySeconds).toBe(1.0);
  });

  it("returns null when no video is arriving yet", () => {
    expect(readJitter(makeStats({}))).toBeNull();
  });

  it("returns null when the counters are missing", () => {
    const stats = makeStats({ v: { type: "inbound-rtp", kind: "video" } });
    expect(readJitter(stats)).toBeNull();
  });

  it("ignores outbound video", () => {
    const stats = makeStats({
      o: { type: "outbound-rtp", kind: "video", jitterBufferDelay: 5, jitterBufferEmittedCount: 5 },
    });
    expect(readJitter(stats)).toBeNull();
  });
});

describe("jitterDelayMs", () => {
  it("measures the recent average, not the lifetime one", () => {
    // Lifetime would say 1.6/150 = 10.7ms, dragged down by a fast start.
    // What matters is what the buffer is charging right now: 12ms.
    const prev = { delaySeconds: 1.0, frames: 100 };
    const cur = { delaySeconds: 1.6, frames: 150 };
    expect(jitterDelayMs(prev, cur)).toBeCloseTo(12, 5);
  });

  it("falls back to the lifetime average on the first sample", () => {
    expect(jitterDelayMs(null, { delaySeconds: 1.6, frames: 150 })).toBeCloseTo(
      10.667,
      2,
    );
  });

  it("returns null when no new frames have arrived", () => {
    // Dividing by zero would render NaN into the status bar.
    const s = { delaySeconds: 1.0, frames: 100 };
    expect(jitterDelayMs(s, s)).toBeNull();
  });

  it("recovers when the counters reset mid-call", () => {
    // An ICE restart can restart the counters. A negative delta would print a
    // negative buffer time, so fall back to the lifetime figure instead.
    const prev = { delaySeconds: 9.0, frames: 900 };
    const cur = { delaySeconds: 0.2, frames: 20 };
    expect(jitterDelayMs(prev, cur)).toBeCloseTo(10, 5);
  });

  it("returns null for a lifetime sample with no frames at all", () => {
    expect(jitterDelayMs(null, { delaySeconds: 0, frames: 0 })).toBeNull();
  });

  it("reports a genuinely small buffer rather than rounding it away", () => {
    const prev = { delaySeconds: 0.5, frames: 100 };
    const cur = { delaySeconds: 0.502, frames: 101 };
    expect(jitterDelayMs(prev, cur)).toBeCloseTo(2, 5);
  });
});
