import { describe, expect, it } from "vitest";
import { VOICE_SPREAD, MUSIC_DUCK_DB, gainFromDb, mixPlan } from "./duetMix";

describe("gainFromDb", () => {
  it("converts zero decibels to unity gain", () => {
    expect(gainFromDb(0)).toBe(1);
  });

  it("converts -6dB to approximately 0.501", () => {
    const result = gainFromDb(-6);
    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeLessThan(0.502);
  });

  it("returns 1 for non-finite values to avoid silent mix", () => {
    expect(gainFromDb(NaN)).toBe(1);
    expect(gainFromDb(Infinity)).toBe(1);
    expect(gainFromDb(-Infinity)).toBe(1);
  });

  it("converts negative decibels to gains less than 1", () => {
    expect(gainFromDb(-12)).toBeLessThan(gainFromDb(-6));
    expect(gainFromDb(-6)).toBeLessThan(gainFromDb(0));
  });

  it("converts positive decibels to gains greater than 1", () => {
    expect(gainFromDb(6)).toBeGreaterThan(1);
    expect(gainFromDb(12)).toBeGreaterThan(gainFromDb(6));
  });
});

describe("mixPlan", () => {
  it("leaves the music alone when nobody sings", () => {
    const plan = mixPlan(false, true);
    expect(plan.musicGain).toBe(1);
  });

  it("holds each voice still when the singing flags flicker", () => {
    // The regression that matters. Voice-activity detection turns on and off
    // several times inside one phrase, so a pan derived from it would slide
    // each voice across the stereo field on every syllable.
    const singing = mixPlan(true, true);
    const silent = mixPlan(false, true);
    expect(silent.minePan).toBe(singing.minePan);
    expect(silent.theirsPan).toBe(singing.theirsPan);
    expect(silent.musicGain).not.toBe(singing.musicGain);
  });

  it("places voices on opposite sides with equal spread when anyone sings", () => {
    const plan = mixPlan(true, true);
    expect(Math.abs(plan.minePan)).toBe(VOICE_SPREAD);
    expect(Math.abs(plan.theirsPan)).toBe(VOICE_SPREAD);
    expect(plan.minePan).toEqual(-plan.theirsPan);
  });

  it("ducks the music when anyone is singing", () => {
    const planNoSing = mixPlan(false, true);
    const planSing = mixPlan(true, true);
    expect(planNoSing.musicGain).toBe(1);
    expect(planSing.musicGain).toBeCloseTo(gainFromDb(MUSIC_DUCK_DB), 5);
    expect(planSing.musicGain).toBeLessThan(1);
  });

  it("puts the anchor's voice on the left and the follower's on the right", () => {
    const anchorPlan = mixPlan(true, true);
    expect(anchorPlan.minePan).toBe(-VOICE_SPREAD);
    expect(anchorPlan.theirsPan).toBe(VOICE_SPREAD);
  });

  it("mirrors the stereo picture for the follower's perspective", () => {
    const anchorPlan = mixPlan(true, true);
    // When iAmAnchor is false, we get the follower's perspective
    // which should be the mirror: follower on left, anchor on right
    const followerPlan = mixPlan(true, false);
    expect(followerPlan.minePan).toBe(VOICE_SPREAD);
    expect(followerPlan.theirsPan).toBe(-VOICE_SPREAD);
    expect(followerPlan.minePan).toEqual(-anchorPlan.minePan);
    expect(followerPlan.theirsPan).toEqual(-anchorPlan.theirsPan);
  });

  it("returns the same gain for both perspectives", () => {
    const anchorPlan = mixPlan(true, true);
    const followerPlan = mixPlan(true, false);
    expect(followerPlan.musicGain).toBe(anchorPlan.musicGain);
  });

  it("maintains voice spread and opposite pans in all singing scenarios", () => {
    const scenarios = [
      { anyoneSinging: true, iAmAnchor: true },
      { anyoneSinging: true, iAmAnchor: false },
      { anyoneSinging: false, iAmAnchor: true },
      { anyoneSinging: false, iAmAnchor: false },
    ];

    for (const scenario of scenarios) {
      const plan = mixPlan(scenario.anyoneSinging, scenario.iAmAnchor);
      // Opposite sides, equal spread, in every scenario including silence:
      // the two voices never share a side and never collapse to the centre.
      expect(plan.minePan).not.toBe(0);
      expect(plan.theirsPan).not.toBe(0);
      expect(plan.minePan).toEqual(-plan.theirsPan);
      expect(Math.abs(plan.minePan)).toBe(VOICE_SPREAD);
    }
  });
});
