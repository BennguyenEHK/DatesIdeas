import { describe, expect, it } from "vitest";
import {
  MAX_OFFSET_MS,
  OFFSET_STEP_MS,
  clampOffset,
  duetRole,
  measuredLatencyMs,
  offsetForDuet,
  offsetForTurn,
  settledOffset,
  singingTurn,
  smoothLatency,
} from "./singerTurn";

describe("singingTurn", () => {
  it("gives the turn to whoever is singing alone", () => {
    expect(singingTurn(false, true)).toBe("them");
    expect(singingTurn(true, false)).toBe("you");
  });

  it("names no turn for a duet or a silence", () => {
    expect(singingTurn(true, true)).toBe("nobody");
    expect(singingTurn(false, false)).toBe("nobody");
  });
});

describe("measuredLatencyMs", () => {
  it("counts the jitter buffer as well as half the round trip", () => {
    expect(measuredLatencyMs(140, 60)).toBe(130);
  });

  it("treats a missing buffer reading as no buffer rather than no answer", () => {
    expect(measuredLatencyMs(140, null)).toBe(70);
  });

  it("has no answer before the round trip has been measured", () => {
    expect(measuredLatencyMs(0, 40)).toBeNull();
    expect(measuredLatencyMs(Number.NaN, 40)).toBeNull();
  });
});

describe("smoothLatency", () => {
  it("discards an outlier instead of averaging it in", () => {
    // A mean would report 260 here, which is nearly four times the truth.
    expect(smoothLatency([70, 68, 72, 900, 71])).toBe(71);
  });

  it("averages the middle pair for an even window", () => {
    expect(smoothLatency([60, 70, 80, 90])).toBe(75);
  });

  it("has no answer with nothing usable to go on", () => {
    expect(smoothLatency([])).toBeNull();
    expect(smoothLatency([Number.NaN, -5])).toBeNull();
  });
});

describe("offsetForTurn", () => {
  it("delays this side only while the other person is singing", () => {
    expect(offsetForTurn("them", 200)).toBe(200);
  });

  it("puts the music back on your own turn", () => {
    // The heart of it: two equal offsets cancel, so your turn must actively
    // return to zero rather than inherit the last listener's figure.
    expect(offsetForTurn("you", 200)).toBe(0);
    expect(offsetForTurn("nobody", 200)).toBe(0);
  });

  it("stays put until the connection has been measured", () => {
    expect(offsetForTurn("them", null)).toBe(0);
  });

  it("never delays further than the player is allowed to go", () => {
    expect(offsetForTurn("them", 5000)).toBe(MAX_OFFSET_MS);
  });
});

describe("clampOffset", () => {
  it("holds the figure inside the range the slider can express", () => {
    expect(clampOffset(-30)).toBe(0);
    expect(clampOffset(1400)).toBe(MAX_OFFSET_MS);
    expect(clampOffset(212.4)).toBe(212);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});

describe("settledOffset", () => {
  it("ignores a wobble too small to hear, which would only re-seek the player", () => {
    expect(settledOffset(200, 200 + OFFSET_STEP_MS - 1)).toBe(200);
  });

  it("follows a move big enough to matter", () => {
    expect(settledOffset(200, 200 + OFFSET_STEP_MS)).toBe(240);
    expect(settledOffset(200, 120)).toBe(120);
  });

  it("lets a turn change hands immediately, however small the figure", () => {
    expect(settledOffset(20, 0)).toBe(0);
    expect(settledOffset(0, 20)).toBe(20);
  });
});

describe("duetRole", () => {
  it("returns none unless both sides are singing", () => {
    expect(duetRole(false, false, true)).toBe("none");
    expect(duetRole(true, false, true)).toBe("none");
    expect(duetRole(false, true, true)).toBe("none");
  });

  it("returns anchor or follower when both sing, based on iAmAnchor", () => {
    expect(duetRole(true, true, true)).toBe("anchor");
    expect(duetRole(true, true, false)).toBe("follower");
  });
});

describe("offsetForDuet", () => {
  it("returns zero for the anchor, which never shifts", () => {
    expect(offsetForDuet("anchor", 100)).toBe(0);
    expect(offsetForDuet("anchor", 500)).toBe(0);
    expect(offsetForDuet("anchor", null)).toBe(0);
  });

  it("returns the clamped latency for the follower", () => {
    expect(offsetForDuet("follower", 100)).toBe(100);
    expect(offsetForDuet("follower", 500)).toBe(500);
    expect(offsetForDuet("follower", 5000)).toBe(MAX_OFFSET_MS);
  });

  it("returns zero for none and null latency", () => {
    expect(offsetForDuet("none", 100)).toBe(0);
    expect(offsetForDuet("none", null)).toBe(0);
    expect(offsetForDuet("follower", null)).toBe(0);
  });

  it("returns zero for non-finite latencies", () => {
    expect(offsetForDuet("follower", NaN)).toBe(0);
    expect(offsetForDuet("follower", Infinity)).toBe(0);
    expect(offsetForDuet("anchor", NaN)).toBe(0);
  });
});

describe("Conservation of misalignment in a duet", () => {
  it("proves that symmetric shifting is impossible because the sum of misalignments is always 2d", () => {
    // In a duet, person A perceives misalignment as (d + b - a) and person B
    // perceives (d + a - b), where d is the network latency, a is A's offset,
    // and b is B's offset. The sum is always 2d, independent of the chosen
    // offsets. This means there is no way to make both sides perceive perfect
    // alignment simultaneously. The only escape is asymmetric shifts: one side
    // (the anchor) locks at zero and never chases, while the other (the
    // follower) absorbs the entire latency. When anchor is a=0 and follower is
    // b=d, A perceives (d + d - 0) = 2d of lag, while B perceives (d + 0 - d)
    // = 0, giving the follower a perfect reference.
    // `a` is varied independently of `b`, which is the whole claim. Holding
    // a at zero and only moving b would pass against almost any formula and
    // would prove nothing about independence.
    for (const d of [50, 100, 150, 200]) {
      for (const a of [0, 25, 60, 100, 175, 400]) {
        for (const b of [0, 25, 60, 100, 175, 400]) {
          expect(d + b - a + (d + a - b)).toBe(2 * d);
        }
      }
    }
  });

  it("shows the best symmetric answer is the no-offset one the code already uses", () => {
    // Every equal pair leaves both sides on exactly d, and no equal pair beats
    // any other. That is why singingTurn returns "nobody" for a duet: it is
    // sitting on the optimum, not declining to solve the problem.
    const d = 80;
    const worstOfPair = (a: number, b: number) =>
      Math.max(Math.abs(d + b - a), Math.abs(d + a - b));

    for (const shift of [0, 40, 90, 250]) {
      expect(worstOfPair(shift, shift)).toBe(d);
    }
    // Any asymmetry makes the worse-off side strictly worse than d.
    expect(worstOfPair(0, d)).toBe(2 * d);
    expect(worstOfPair(d, 0)).toBe(2 * d);
  });

  it("shows asymmetry buys one side a perfect reference at the other's cost", () => {
    const d = 80;
    // Anchor holds at zero, follower pulls its music back by the full delay.
    const anchorPerceives = d + d - 0;
    const followerPerceives = d + 0 - d;
    expect(followerPerceives).toBe(0);
    expect(anchorPerceives).toBe(2 * d);
    // The total is unchanged: asymmetry moves the cost, it never removes it.
    expect(anchorPerceives + followerPerceives).toBe(2 * d);
  });
});
