import { describe, it, expect } from "vitest";
import {
  NOTICE_MS,
  countdownLeft,
  formatCountdown,
  reduceEnding,
  type EndingPhase,
} from "./ending";

describe("reduceEnding", () => {
  it("starts counting when somebody calls the end", () => {
    expect(reduceEnding("none", { kind: "set", endsAt: 1000 })).toBe("counting");
  });

  it("goes back to nothing when it is called off", () => {
    // The button is one press away from the end of somebody's evening, so
    // pressing it by accident has to be undoable rather than merely regretted.
    expect(reduceEnding("counting", { kind: "set", endsAt: null })).toBe("none");
  });

  it("moves to the closing picture when the countdown runs out", () => {
    expect(reduceEnding("counting", { kind: "reached" })).toBe("closing");
  });

  it("goes dark once the picture has collapsed", () => {
    expect(reduceEnding("closing", { kind: "collapsed" })).toBe("dark");
  });

  it("cannot be called off once the picture is already going", () => {
    // Past this point the room is mid-animation and the other side is too.
    // Reviving it would leave the two of you in different places.
    expect(reduceEnding("closing", { kind: "set", endsAt: null })).toBe("closing");
    expect(reduceEnding("dark", { kind: "set", endsAt: null })).toBe("dark");
  });

  it("cannot be restarted once the picture is already going", () => {
    expect(reduceEnding("closing", { kind: "set", endsAt: 9999 })).toBe("closing");
  });

  it("ignores an arrival that does not belong to the phase it is in", () => {
    // Both sides count down independently to the same shared instant, so a
    // late or duplicated message is ordinary rather than exceptional.
    expect(reduceEnding("none", { kind: "reached" })).toBe("none");
    expect(reduceEnding("counting", { kind: "collapsed" })).toBe("counting");
  });

  it("never returns a phase outside the four it knows", () => {
    const phases: EndingPhase[] = ["none", "counting", "closing", "dark"];
    for (const phase of phases) {
      for (const event of [
        { kind: "set", endsAt: 1 } as const,
        { kind: "set", endsAt: null } as const,
        { kind: "reached" } as const,
        { kind: "collapsed" } as const,
      ]) {
        expect(phases).toContain(reduceEnding(phase, event));
      }
    }
  });
});

describe("countdownLeft", () => {
  it("measures against the shared clock, not this machine's", () => {
    expect(countdownLeft(5_000, 1_000)).toBe(4_000);
  });

  it("floors at zero rather than counting backwards", () => {
    expect(countdownLeft(1_000, 5_000)).toBe(0);
  });

  it("is zero when no ending has been called", () => {
    expect(countdownLeft(null, 5_000)).toBe(0);
  });

  it("gives the full notice at the moment it is called", () => {
    const now = 1_700_000_000_000;
    expect(countdownLeft(now + NOTICE_MS, now)).toBe(NOTICE_MS);
  });
});

describe("formatCountdown", () => {
  it("reads as a clock, because that is what a countdown is", () => {
    expect(formatCountdown(298_000)).toBe("4:58");
  });

  it("pads the seconds so the width never jumps", () => {
    // An unpadded 4:7 shortens the line every ten seconds, which in the corner
    // of the screen reads as a glitch rather than as time passing.
    expect(formatCountdown(247_000)).toBe("4:07");
  });

  it("shows the last seconds rather than rounding them away", () => {
    expect(formatCountdown(7_000)).toBe("0:07");
    expect(formatCountdown(999)).toBe("0:00");
  });

  it("never shows a negative time", () => {
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});
