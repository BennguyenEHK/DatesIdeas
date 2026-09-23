import { describe, expect, it } from "vitest";
import { EMPTY_LINK, type LinkSnapshot } from "@/lib/rtc/linkSnapshot";
import {
  TRANSFER_MAX_KBPS,
  TRANSFER_MIN_KBPS,
  TRANSFER_SHARE,
  TRANSFER_UNKNOWN_KBPS,
  delayForChunkMs,
  nextSendAt,
  paceKbps,
  shouldHold,
} from "./transferPacer";

function link(overrides: Partial<LinkSnapshot> = {}): LinkSnapshot {
  return { ...EMPTY_LINK, ...overrides };
}

describe("paceKbps", () => {
  it("takes a share of the outgoing estimate", () => {
    // The relay from the field report: ~700 kbps, of which the song gets 30%.
    expect(TRANSFER_SHARE).toBe(0.3);
    expect(paceKbps(link({ outgoingKbps: 700 }))).toBeCloseTo(210);
  });

  it("uses a relay-sized guess, never unlimited, before anything is measured", () => {
    expect(TRANSFER_UNKNOWN_KBPS).toBe(160);
    expect(paceKbps(EMPTY_LINK)).toBe(TRANSFER_UNKNOWN_KBPS);
    expect(paceKbps(link({ outgoingKbps: Number.NaN }))).toBe(
      TRANSFER_UNKNOWN_KBPS,
    );
    expect(paceKbps(link({ outgoingKbps: Number.POSITIVE_INFINITY }))).toBe(
      TRANSFER_UNKNOWN_KBPS,
    );
  });

  it("never drops below the floor", () => {
    expect(TRANSFER_MIN_KBPS).toBe(48);
    expect(paceKbps(link({ outgoingKbps: 100 }))).toBe(TRANSFER_MIN_KBPS);
    expect(paceKbps(link({ outgoingKbps: 0 }))).toBe(TRANSFER_MIN_KBPS);
  });

  it("never rises above the ceiling", () => {
    expect(TRANSFER_MAX_KBPS).toBe(1500);
    expect(paceKbps(link({ outgoingKbps: 50_000 }))).toBe(TRANSFER_MAX_KBPS);
  });
});

describe("shouldHold", () => {
  it("never holds on figures nobody has measured", () => {
    expect(shouldHold(EMPTY_LINK)).toBe(false);
  });

  it("holds when the other side reports losing our voice", () => {
    expect(shouldHold(link({ theirLossPct: 3.1 }))).toBe(true);
    expect(shouldHold(link({ theirLossPct: 3 }))).toBe(false);
  });

  it("holds when the other side reports our voice jittering", () => {
    expect(shouldHold(link({ theirJitterMs: 401 }))).toBe(true);
    expect(shouldHold(link({ theirJitterMs: 400 }))).toBe(false);
  });

  it("falls back on our own reception only when they have reported nothing", () => {
    expect(shouldHold(link({ audioLossPct: 5.3 }))).toBe(true);
    expect(shouldHold(link({ audioJitterMs: 1813 }))).toBe(true);
    expect(shouldHold(link({ audioLossPct: 3, audioJitterMs: 400 }))).toBe(
      false,
    );
  });

  it("trusts a healthy report from them over our own bad reception", () => {
    expect(shouldHold(link({ theirLossPct: 0, audioLossPct: 10 }))).toBe(false);
    expect(shouldHold(link({ theirJitterMs: 20, audioJitterMs: 2000 }))).toBe(
      false,
    );
  });
});

describe("delayForChunkMs", () => {
  it("is the time one chunk occupies the link at the rate", () => {
    // 16 KB at 210 kbps: 131072 bits at 210 bits per millisecond.
    expect(delayForChunkMs(16 * 1024, 210)).toBeCloseTo(624.15, 1);
    expect(delayForChunkMs(1000, 8)).toBe(1000);
  });

  it("is at least a millisecond", () => {
    expect(delayForChunkMs(1, 1500)).toBe(1);
    expect(delayForChunkMs(0, 160)).toBe(1);
  });

  it("does not break on a rate of zero", () => {
    expect(delayForChunkMs(16 * 1024, 0)).toBe(1);
  });
});

describe("nextSendAt", () => {
  it("counts from the previous slot, not from when the loop got there", () => {
    expect(nextSendAt(10_000, 1000, 8)).toBe(11_000);
  });

  it("chains so a run of chunks takes exactly its share of time", () => {
    let at = 0;
    for (let i = 0; i < 10; i += 1) at = nextSendAt(at, 16 * 1024, 160);
    expect(at).toBeCloseTo((10 * 16 * 1024 * 8) / 160);
  });
});
