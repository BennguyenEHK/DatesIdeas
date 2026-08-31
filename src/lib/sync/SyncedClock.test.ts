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
    expect(c.now()).toBe(15_200);
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
