import { describe, it, expect } from "vitest";
import { selectPath } from "./path";

/**
 * The old reporter took the FIRST candidate pair whose state was "succeeded".
 * Several pairs can succeed at once — ICE tests them in parallel — while only
 * one is actually carrying media. So the status bar could describe a route the
 * call was not using, which is exactly the indicator you would reach for when
 * asking "why is this slow?".
 */

type Entry = Record<string, unknown>;

/** RTCStatsReport is Map-like: `values()` to iterate, `get(id)` to resolve refs. */
const makeStats = (entries: Record<string, Entry>) =>
  new Map(Object.entries(entries)) as unknown as RTCStatsReport;

const host = { type: "local-candidate", candidateType: "host" };
const relay = { type: "local-candidate", candidateType: "relay" };
const srflx = { type: "local-candidate", candidateType: "srflx" };

describe("selectPath", () => {
  it("follows the transport's selected pair rather than the first success", () => {
    const stats = makeStats({
      // Listed first, and succeeded — but not the one in use.
      relayPair: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "relayCand",
        currentRoundTripTime: 0.112,
      },
      directPair: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "hostCand",
        currentRoundTripTime: 0.003,
      },
      relayCand: relay,
      hostCand: host,
      t: { type: "transport", selectedCandidatePairId: "directPair" },
    });

    const path = selectPath(stats);
    expect(path?.relayed).toBe(false);
    expect(path?.netRtt).toBe(3);
  });

  it("reports a relay when the relay pair is the selected one", () => {
    const stats = makeStats({
      directPair: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "hostCand",
        currentRoundTripTime: 0.003,
      },
      relayPair: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "relayCand",
        currentRoundTripTime: 0.112,
      },
      hostCand: host,
      relayCand: relay,
      t: { type: "transport", selectedCandidatePairId: "relayPair" },
    });

    const path = selectPath(stats);
    expect(path?.relayed).toBe(true);
    expect(path?.netRtt).toBe(112);
  });

  it("falls back to the nominated pair when there is no transport entry", () => {
    // Firefox has not always exposed selectedCandidatePairId.
    const stats = makeStats({
      relayPair: {
        type: "candidate-pair",
        state: "succeeded",
        nominated: false,
        localCandidateId: "relayCand",
        currentRoundTripTime: 0.112,
      },
      directPair: {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "hostCand",
        currentRoundTripTime: 0.004,
      },
      relayCand: relay,
      hostCand: host,
    });

    const path = selectPath(stats);
    expect(path?.relayed).toBe(false);
    expect(path?.netRtt).toBe(4);
  });

  it("falls back to any succeeded pair when nothing is nominated", () => {
    const stats = makeStats({
      p: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "c",
        currentRoundTripTime: 0.05,
      },
      c: srflx,
    });
    expect(selectPath(stats)?.netRtt).toBe(50);
  });

  it("ignores pairs that have not succeeded", () => {
    const stats = makeStats({
      p: { type: "candidate-pair", state: "in-progress", localCandidateId: "c" },
      c: host,
    });
    expect(selectPath(stats)).toBeNull();
  });

  it("returns null when there are no candidate pairs at all", () => {
    expect(selectPath(makeStats({}))).toBeNull();
  });

  it("returns null when the transport points at a pair that is missing", () => {
    const stats = makeStats({
      t: { type: "transport", selectedCandidatePairId: "gone" },
    });
    expect(selectPath(stats)).toBeNull();
  });

  it("reports the route even when the round-trip time is not yet known", () => {
    // The pair exists before the first measurement lands. Saying "direct" with
    // an unknown cost beats saying nothing.
    const stats = makeStats({
      p: { type: "candidate-pair", state: "succeeded", localCandidateId: "c" },
      c: host,
      t: { type: "transport", selectedCandidatePairId: "p" },
    });
    const path = selectPath(stats);
    expect(path?.netRtt).toBeNull();
    expect(path?.relayed).toBe(false);
  });

  it("treats an unresolvable local candidate as not relayed", () => {
    // Never claim a relay on missing evidence: it would send someone chasing a
    // network problem that is not there.
    const stats = makeStats({
      p: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "missing",
        currentRoundTripTime: 0.01,
      },
      t: { type: "transport", selectedCandidatePairId: "p" },
    });
    expect(selectPath(stats)?.relayed).toBe(false);
  });

  it("exposes both candidate types for the readout", () => {
    const stats = makeStats({
      p: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "l",
        remoteCandidateId: "r",
        currentRoundTripTime: 0.002,
      },
      l: host,
      r: { type: "remote-candidate", candidateType: "srflx" },
      t: { type: "transport", selectedCandidatePairId: "p" },
    });
    const path = selectPath(stats);
    expect(path?.localType).toBe("host");
    expect(path?.remoteType).toBe("srflx");
  });

  it("rounds sub-millisecond times instead of reporting a bare zero", () => {
    const stats = makeStats({
      p: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "c",
        currentRoundTripTime: 0.0004,
      },
      c: host,
      t: { type: "transport", selectedCandidatePairId: "p" },
    });
    // 0.4ms is a real LAN figure; it must survive as a number, not vanish.
    expect(selectPath(stats)?.netRtt).toBeCloseTo(0.4, 5);
  });
});
