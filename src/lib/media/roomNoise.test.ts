import { describe, expect, it } from "vitest";
import { judgeRoom } from "./roomNoise";

const windowOf = (floor: number, voice = floor): number[] => [
  ...Array<number>(40).fill(floor),
  ...Array<number>(10).fill(voice),
];

describe("judgeRoom", () => {
  it("needs a complete continuous window", () => {
    const reading = judgeRoom(Array<number>(49).fill(0.005));
    expect(reading).toMatchObject({ floorRms: 0.005, voiceRms: 0.005, snrDb: null, verdict: "unsure" });
  });

  it("does not mistake a muted microphone for a quiet room", () => {
    expect(judgeRoom(Array<number>(50).fill(0))).toMatchObject({ snrDb: null, verdict: "unsure" });
  });

  it("recognizes a voice clearly above a quiet floor", () => {
    const reading = judgeRoom(windowOf(0.005, 0.2));
    expect(reading.snrDb).toBeCloseTo(32.04, 2);
    expect(reading.verdict).toBe("quiet");
  });

  it("recognizes a voice too close to its room", () => {
    const reading = judgeRoom(windowOf(0.02, 0.1));
    expect(reading.snrDb).toBeCloseTo(13.98, 2);
    expect(reading.verdict).toBe("noisy");
  });

  it("leaves the SNR gap undecided", () => {
    const reading = judgeRoom(windowOf(0.01, 0.1));
    expect(reading.snrDb).toBeCloseTo(20, 5);
    expect(reading.verdict).toBe("unsure");
  });

  it("recognizes a loud room when nobody clearly spoke", () => {
    expect(judgeRoom(windowOf(0.04)).verdict).toBe("noisy");
  });

  it("does not call a boosted but silent headphone room noisy", () => {
    // The meter reads after the headphone boost, which lifts an ordinary quiet
    // room to around 0.01. Without a voice to compare, that is not evidence.
    expect(judgeRoom(windowOf(0.015)).verdict).toBe("unsure");
  });

  it("leaves a modest room undecided without a voice", () => {
    expect(judgeRoom(windowOf(0.004)).verdict).toBe("unsure");
  });

  it("ignores invalid meter readings", () => {
    const reading = judgeRoom([Number.NaN, Number.POSITIVE_INFINITY, -1, ...windowOf(0.005, 0.2)]);
    expect(reading).toMatchObject({ floorRms: 0.005, voiceRms: 0.2, verdict: "quiet" });
  });

  it("does not reorder the caller's samples", () => {
    const samples = [...windowOf(0.005, 0.2)].reverse();
    const original = [...samples];
    judgeRoom(samples);
    expect(samples).toEqual(original);
  });

  it("uses nearest-rank percentiles", () => {
    const samples = Array.from({ length: 50 }, (_, index) => index + 1);
    expect(judgeRoom(samples)).toMatchObject({ floorRms: 10, voiceRms: 45 });
  });
});
