import { describe, expect, it } from "vitest";

import {
  pausedAt,
  positionAt,
  resumedAt,
  seekedTo,
  startedAt,
  withRate,
} from "./audioClock";

describe("audio clock", () => {
  it("derives a playing position from the context clock and clamps it", () => {
    const state = startedAt(10, 3, 2);

    expect(positionAt(state, 7)).toBe(6);
    expect(positionAt(state, 99)).toBe(10);
  });

  it("does not rewind for a context reading before the saved instant", () => {
    const state = startedAt(10, 5, 4);

    expect(positionAt(state, 2)).toBe(4);
  });

  it("rebases before changing rate so the new rate cannot rewrite history", () => {
    const started = startedAt(20, 0, 0);
    const doubled = withRate(started, 2, 2);

    expect(positionAt(doubled, 4)).toBe(6);
    expect(positionAt(doubled, 4)).not.toBe(8);
  });

  it("rebases pause and resume transitions, including repeated transitions", () => {
    const started = startedAt(20, 0, 1);
    const paused = pausedAt(started, 3);
    const pausedAgain = pausedAt(paused, 6);
    const resumed = resumedAt(pausedAgain, 8);
    const resumedAgain = resumedAt(resumed, 10);

    expect(positionAt(pausedAgain, 7)).toBe(4);
    expect(positionAt(resumedAgain, 12)).toBe(8);
  });

  it("seeks within the track without changing rate or playback state", () => {
    const playing = withRate(startedAt(10, 0, 1), 2, 1.5);
    const sought = seekedTo(playing, 3, 99);
    const paused = pausedAt(playing, 3);
    const pausedSought = seekedTo(paused, 4, -1);

    expect(sought).toMatchObject({ positionSec: 10, playing: true, rate: 1.5 });
    expect(pausedSought).toMatchObject({ positionSec: 0, playing: false, rate: 1.5 });
  });

  it("turns malformed numeric inputs into safe clock values", () => {
    const state = startedAt(Number.NaN, Number.NaN, Number.NaN, Number.NaN);
    const changed = withRate(state, Number.NaN, Number.NaN);
    const sought = seekedTo(changed, Number.NaN, Number.NaN);

    expect(positionAt(sought, Number.NaN)).toBe(0);
    expect(Object.values(sought).some((value) => Number.isNaN(value))).toBe(false);
    expect(changed.rate).toBe(1);
  });
});
