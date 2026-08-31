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

  /** Shared timebase. Equal on both peers to within one-way jitter. */
  now(): number {
    return this.localNow() + this.offset;
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
