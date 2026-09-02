import { describe, expect, it } from "vitest";
import {
  MAX_OFFSET_MS,
  OFFSET_STEP_MS,
  clampOffset,
  measuredLatencyMs,
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
