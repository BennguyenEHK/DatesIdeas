import type { PeerMessage } from "@/lib/rtc/protocol";

export interface ClockSample {
  rtt: number;
  offset: number;
}

/**
 * Picks the sample least polluted by queueing jitter: the one with the
 * lowest round-trip time. Do NOT average — a high-RTT sample carries an
 * asymmetric, unmeasurable bias, and averaging drags the estimate into it.
 */
export function selectSample(samples: ClockSample[]): ClockSample | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, s) => (s.rtt < best.rtt ? s : best));
}

export const LEAD_BUFFER_MS = 50;
/**
 * No legitimate schedule reaches this far out — leadTime is one-way plus 50ms,
 * a few hundred milliseconds even on a bad link. Anything beyond it means the
 * timebase is wrong, and firing late beats leaving the peer staring at nothing.
 */
export const MAX_SCHEDULE_MS = 2000;
const DEFAULT_SAMPLES = 7;
const SAMPLE_INTERVAL_MS = 120;
const RESYNC_INTERVAL_MS = 30_000;

export interface SyncedClockOptions {
  send: (m: PeerMessage) => void;
  now?: () => number;
  samples?: number;
}

export class SyncedClock {
  private readonly send: (m: PeerMessage) => void;
  private readonly localNow: () => number;
  private readonly sampleTarget: number;

  private pending = new Map<number, number>();
  private collected: ClockSample[] = [];
  private best: ClockSample | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private _lateFires = 0;
  private _wildFires = 0;

  constructor(opts: SyncedClockOptions) {
    this.send = opts.send;
    this.localNow = opts.now ?? Date.now;
    this.sampleTarget = opts.samples ?? DEFAULT_SAMPLES;
  }

  get synced(): boolean {
    return this.best !== null;
  }
  get offset(): number {
    return this.best?.offset ?? 0;
  }
  get rtt(): number {
    return this.best?.rtt ?? 0;
  }
  get oneWay(): number {
    return this.rtt / 2;
  }
  get lateFires(): number {
    return this._lateFires;
  }
  /** Schedules so far out they can only mean a broken clock. */
  get wildFires(): number {
    return this._wildFires;
  }

  /**
   * Shared timebase: the midpoint between the two machines' clocks.
   *
   * HALF the offset, deliberately. `offset` is how far ahead the peer's clock
   * runs, so `localNow() + offset` would be this peer's estimate of the OTHER
   * one's clock — which reads B's clock on A and A's clock on B. That is not
   * shared at all. A sender would compute `showAt` against the receiver's
   * clock while the receiver measured it against the sender's, putting the
   * meme late by the entire difference between two laptop clocks.
   *
   * Taking half lands both peers on the same instant: A reports a + skew/2,
   * B reports b - skew/2, and those are the same moment. It stays correct
   * however far the two machines have drifted apart.
   */
  now(): number {
    return this.localNow() + this.offset / 2;
  }

  /** How far ahead to schedule so the peer receives the instruction in time. */
  leadTime(): number {
    return this.oneWay + LEAD_BUFFER_MS;
  }

  scheduleAt(sharedTime: number, fn: () => void): void {
    const delay = sharedTime - this.now();
    if (delay <= 0) {
      this._lateFires += 1;
      fn();
      return;
    }
    // Defence in depth behind the midpoint fix: never hold a reaction back for
    // a length of time that could only come from a broken clock.
    if (delay > MAX_SCHEDULE_MS) {
      this._wildFires += 1;
      fn();
      return;
    }
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, delay);
    this.timers.add(id);
  }

  startSync(): void {
    this.collected = [];
    this.emitPing();
    for (let i = 1; i < this.sampleTarget; i++) {
      const id = setTimeout(() => {
        this.timers.delete(id);
        this.emitPing();
      }, i * SAMPLE_INTERVAL_MS);
      this.timers.add(id);
    }
    if (this.resyncTimer === null) {
      this.resyncTimer = setInterval(() => this.startSync(), RESYNC_INTERVAL_MS);
    }
  }

  handleMessage(m: PeerMessage): void {
    if (m.t === "ping") {
      this.send({ t: "pong", t0: m.t0, t1: this.localNow() });
      return;
    }
    if (m.t !== "pong") return;

    const sentAt = this.pending.get(m.t0);
    if (sentAt === undefined) return;
    this.pending.delete(m.t0);

    const t2 = this.localNow();
    const rtt = t2 - sentAt;
    const offset = m.t1 - (sentAt + rtt / 2);
    this.collected.push({ rtt, offset });

    const winner = selectSample(this.collected);
    if (winner) this.best = winner;
  }

  stop(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    if (this.resyncTimer !== null) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    this.pending.clear();
  }

  private emitPing(): void {
    const t0 = this.localNow();
    this.pending.set(t0, t0);
    this.send({ t: "ping", t0 });
  }
}
