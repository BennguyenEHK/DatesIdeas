import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncedClock, selectSample, type ClockSample } from "./SyncedClock";
import type { PeerMessage } from "@/lib/rtc/protocol";

describe("selectSample", () => {
  it("returns null for no samples", () => {
    expect(selectSample([])).toBeNull();
  });

  it("picks the sample with the lowest rtt, not the mean", () => {
    const samples: ClockSample[] = [
      { rtt: 400, offset: 900 },
      { rtt: 200, offset: 1000 },
      { rtt: 380, offset: 1150 },
    ];
    expect(selectSample(samples)).toEqual({ rtt: 200, offset: 1000 });
  });

  it("ignores a badly skewed high-rtt sample that would poison an average", () => {
    // True offset is 1000. The 2000ms sample is skewed by a stalled return leg.
    const samples: ClockSample[] = [
      { rtt: 210, offset: 1002 },
      { rtt: 2000, offset: 1850 },
    ];
    const chosen = selectSample(samples)!;
    expect(chosen.offset).toBe(1002);
    // An average would have produced ~1426 — far outside tolerance.
    expect(Math.abs(chosen.offset - 1000)).toBeLessThan(50);
  });
});

describe("SyncedClock", () => {
  let sent: PeerMessage[];
  let fakeNow: number;
  const now = () => fakeNow;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    fakeNow = 10_000;
  });
  afterEach(() => vi.useRealTimers());

  function makeClock() {
    return new SyncedClock({
      send: (m) => sent.push(m),
      now,
      samples: 3,
    });
  }

  it("is not synced before any pong arrives", () => {
    const c = makeClock();
    expect(c.synced).toBe(false);
    expect(c.now()).toBe(10_000);
  });

  it("computes offset from a ping/pong exchange", () => {
    const c = makeClock();
    c.startSync();
    // One ping was sent at t0 = 10000.
    const ping = sent.at(-1) as { t: "ping"; t0: number };
    expect(ping.t).toBe("ping");

    // Peer's clock is 5000ms ahead. Symmetric 200ms round trip.
    fakeNow = 10_200;
    c.handleMessage({ t: "pong", t0: ping.t0, t1: ping.t0 + 100 + 5000 });

    expect(c.rtt).toBe(200);
    expect(c.oneWay).toBe(100);
    expect(c.offset).toBe(5000);
    // The midpoint between the two machines, NOT the peer's clock. Returning
    // the peer's clock makes now() mean something different on each side, and
    // then a timestamp computed by one peer means the wrong instant to the
    // other. See the two-peer tests below.
    expect(c.now()).toBe(12_700);
    expect(c.synced).toBe(true);
  });

  it("replies to a ping with a pong carrying local receipt time", () => {
    const c = makeClock();
    fakeNow = 42_000;
    c.handleMessage({ t: "ping", t0: 7 });
    expect(sent.at(-1)).toEqual({ t: "pong", t0: 7, t1: 42_000 });
  });

  it("leadTime is oneWay plus a 50ms buffer", () => {
    const c = makeClock();
    c.startSync();
    const ping = sent.at(-1) as { t: "ping"; t0: number };
    fakeNow = 10_200;
    c.handleMessage({ t: "pong", t0: ping.t0, t1: ping.t0 + 100 });
    expect(c.leadTime()).toBe(150);
  });

  it("scheduleAt fires the callback at the shared timestamp", () => {
    const c = makeClock();
    const fn = vi.fn();
    c.scheduleAt(10_300, fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("scheduleAt fires immediately and counts a late fire for a past target", () => {
    const c = makeClock();
    const fn = vi.fn();
    c.scheduleAt(9_000, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.lateFires).toBe(1);
  });

  it("stop cancels pending scheduled callbacks", () => {
    const c = makeClock();
    const fn = vi.fn();
    c.scheduleAt(10_500, fn);
    c.stop();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

/**
 * Regression tests for memes arriving a minute late.
 *
 * now() used to return `localNow() + offset`, which is this peer's estimate of
 * THE OTHER peer's clock. That is not a shared timebase: on machine A it reads
 * B's clock, on machine B it reads A's. A sender computed `showAt` against the
 * receiver's clock, and the receiver then measured that same number against
 * the sender's — so the meme landed late by the full difference between the
 * two system clocks. Two laptops are routinely a minute apart, which is
 * exactly how long the emoji took to appear.
 *
 * The fix is the midpoint: half the offset. Both peers land on the same
 * instant no matter how far their machine clocks have drifted.
 */
describe("SyncedClock across two peers", () => {
  const ONE_WAY = 50;

  /**
   * Two machines whose system clocks disagree by `skew`, exchanging a full
   * ping/pong in each direction over a symmetric link.
   */
  function pair(skew: number) {
    let real = 0;
    const sentA: PeerMessage[] = [];
    const sentB: PeerMessage[] = [];

    const a = new SyncedClock({
      send: (m) => sentA.push(m),
      now: () => real,
      samples: 1,
    });
    const b = new SyncedClock({
      send: (m) => sentB.push(m),
      now: () => real + skew,
      samples: 1,
    });

    // A pings B.
    a.startSync();
    const pingA = sentA.at(-1)!;
    real += ONE_WAY;
    b.handleMessage(pingA);
    const pongB = sentB.at(-1)!;
    real += ONE_WAY;
    a.handleMessage(pongB);

    // B pings A, over the same link.
    real = 0;
    b.startSync();
    const pingB = sentB.at(-1)!;
    real += ONE_WAY;
    a.handleMessage(pingB);
    const pongA = sentA.at(-1)!;
    real += ONE_WAY;
    b.handleMessage(pongA);

    return { a, b, at: (t: number) => (real = t) };
  }

  it("both peers agree on now() when machine clocks differ by a minute", () => {
    const { a, b } = pair(60_000);
    expect(a.synced && b.synced).toBe(true);
    // The heart of the bug: these used to differ by the full 60 seconds.
    expect(Math.abs(a.now() - b.now())).toBeLessThan(1);
  });

  it("agrees when the skew runs the other way", () => {
    const { a, b } = pair(-45_000);
    expect(Math.abs(a.now() - b.now())).toBeLessThan(1);
  });

  it("agrees when the machine clocks happen to match", () => {
    const { a, b } = pair(0);
    expect(Math.abs(a.now() - b.now())).toBeLessThan(1);
  });

  it("delivers a meme after leadTime, not after the clock skew", () => {
    vi.useFakeTimers();
    try {
      const { a, b } = pair(60_000);
      const shown = vi.fn();

      // A fires a gesture and schedules it for both sides.
      const showAt = a.now() + a.leadTime();
      b.scheduleAt(showAt, shown);

      // Well past leadTime (~100ms) but nowhere near the 60s skew.
      vi.advanceTimersByTime(a.leadTime() + 20);
      expect(shown).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("both peers schedule the same instant to within a few ms", () => {
    const { a, b } = pair(37_500);
    const showAt = a.now() + a.leadTime();
    // What each peer thinks the wait is. They must agree.
    const waitOnA = showAt - a.now();
    const waitOnB = showAt - b.now();
    expect(Math.abs(waitOnA - waitOnB)).toBeLessThan(1);
  });
});

describe("SyncedClock.scheduleAt guard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refuses to sit on an absurd delay", () => {
    // A timestamp this far out means the timebase is wrong, not that the peer
    // wanted a two-minute pause. Showing late beats never showing at all.
    const c = new SyncedClock({ send: () => {}, now: () => 0, samples: 1 });
    const fn = vi.fn();
    c.scheduleAt(120_000, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.wildFires).toBe(1);
  });

  it("still honours a normal lead time", () => {
    const c = new SyncedClock({ send: () => {}, now: () => 0, samples: 1 });
    const fn = vi.fn();
    c.scheduleAt(150, fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.wildFires).toBe(0);
  });
});
