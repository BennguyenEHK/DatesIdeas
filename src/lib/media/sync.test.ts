import { describe, it, expect } from "vitest";
import {
  targetPosition,
  needsCorrection,
  stateAt,
  DRIFT_TOLERANCE_SEC,
  SINGING_TOLERANCE_SEC,
  toleranceFor,
  RAMP_RATE,
  MAX_RAMP_SEC,
  rampPlan,
  DURATION_MATCH_SEC,
  filmsMatch,
  type PlaybackState,
} from "./sync";
import { youTubeId, youTubeStart } from "./youtube";

const playing: PlaybackState = {
  videoId: "dQw4w9WgXcQ",
  source: "youtube",
  durationSec: null,
  positionSec: 30,
  playing: true,
  atSharedTime: 100_000,
};

describe("targetPosition", () => {
  it("advances with the shared clock while playing", () => {
    expect(targetPosition(playing, 100_000)).toBe(30);
    expect(targetPosition(playing, 102_500)).toBe(32.5);
  });

  it("holds still while paused", () => {
    const paused = { ...playing, playing: false };
    expect(targetPosition(paused, 999_999)).toBe(30);
  });

  it("does not run ahead of an instant that has not arrived", () => {
    // A message scheduled slightly in the future must not rewind the video
    // below where the sender said it was.
    expect(targetPosition(playing, 99_000)).toBe(30);
  });

  it("never returns a negative position", () => {
    const early: PlaybackState = { ...playing, positionSec: 0 };
    expect(targetPosition(early, 90_000)).toBe(0);
  });

  it("pulls this listener's copy back without seeking before the song", () => {
    expect(targetPosition(playing, 102_500, 0.35)).toBe(32.15);
    expect(targetPosition({ ...playing, positionSec: 0, playing: false }, 100_000, 0.35)).toBe(0);
  });

  it("keeps both peers on the same target from the same state", () => {
    // The property that matters: the state is absolute on the shared clock, so
    // two peers reading it at the same instant compute the same position.
    const at = 105_000;
    expect(targetPosition(playing, at)).toBe(targetPosition({ ...playing }, at));
  });
});

describe("needsCorrection", () => {
  it("ignores drift a player produces just by existing", () => {
    expect(needsCorrection(30, 30.05)).toBe(false);
  });

  it("corrects once the two would be on different words", () => {
    expect(needsCorrection(30, 31.5)).toBe(true);
    expect(needsCorrection(31.5, 30)).toBe(true);
  });

  it("corrects a gap a singer would feel as dragging", () => {
    // A fifth of a second is a third of a beat at a normal tempo, and it is
    // heard as the other person singing behind the music rather than as a
    // sync problem.
    expect(needsCorrection(30, 30.2)).toBe(true);
  });

  it("is symmetric about the tolerance", () => {
    const just = DRIFT_TOLERANCE_SEC - 0.01;
    expect(needsCorrection(30, 30 + just)).toBe(false);
    expect(needsCorrection(30, 30 - just)).toBe(false);
    const past = DRIFT_TOLERANCE_SEC + 0.01;
    expect(needsCorrection(30, 30 + past)).toBe(true);
    expect(needsCorrection(30, 30 - past)).toBe(true);
  });

  it("keeps the tolerance well under a sung syllable", () => {
    // Seeking clicks the audio, so correcting every wobble sounds worse than
    // the wobble. This has to stay in the gap between those two failures.
    expect(DRIFT_TOLERANCE_SEC).toBeGreaterThan(0.05);
    expect(DRIFT_TOLERANCE_SEC).toBeLessThan(0.2);
  });
});

describe("stateAt", () => {
  it("stamps the state with the instant it describes", () => {
    const film = {
      videoId: "abc12345678",
      source: "youtube" as const,
      durationSec: null,
    };
    expect(stateAt(film, 12.5, true, 50_000)).toEqual({
      ...film,
      positionSec: 12.5,
      playing: true,
      atSharedTime: 50_000,
    });
  });
});

describe("youTubeId", () => {
  it("reads the address-bar link", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("reads the share link", () => {
    expect(youTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("survives the parameters a real copied link carries", () => {
    expect(
      youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4&t=90s"),
    ).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://youtu.be/dQw4w9WgXcQ?si=abcdef&t=42")).toBe("dQw4w9WgXcQ");
  });

  it("reads embed, shorts and live links", () => {
    expect(youTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("reads mobile and music hosts", () => {
    expect(youTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("copes with a link pasted without its scheme", () => {
    expect(youTubeId("youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("accepts a bare id, which is what pasting twice produces", () => {
    expect(youTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("trims surrounding whitespace", () => {
    expect(youTubeId("  https://youtu.be/dQw4w9WgXcQ \n")).toBe("dQw4w9WgXcQ");
  });

  it("rejects anything that is not a YouTube video", () => {
    expect(youTubeId("")).toBeNull();
    expect(youTubeId("   ")).toBeNull();
    expect(youTubeId("not a link")).toBeNull();
    expect(youTubeId("https://vimeo.com/123456")).toBeNull();
    expect(youTubeId("https://www.youtube.com/")).toBeNull();
    expect(youTubeId("https://www.youtube.com/watch?v=tooshort")).toBeNull();
    expect(youTubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("is not fooled by a lookalike host", () => {
    // youtube.com.evil.example is not youtube.com.
    expect(youTubeId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("youTubeStart", () => {
  it("reads a plain seconds offset", () => {
    expect(youTubeStart("https://youtu.be/abc?t=90")).toBe(90);
  });

  it("reads an hours/minutes/seconds offset", () => {
    expect(youTubeStart("https://youtu.be/abc?t=1m30s")).toBe(90);
    expect(youTubeStart("https://youtu.be/abc?t=1h2m3s")).toBe(3723);
  });

  it("is zero when the link carries no timestamp", () => {
    expect(youTubeStart("https://youtu.be/abc")).toBe(0);
  });
});

describe("filmsMatch", () => {
  const local = (durationSec: number | null) => ({
    videoId: "Inception.mp4",
    source: "local" as const,
    durationSec,
  });

  it("accepts two copies that differ only by a rounding", () => {
    // Encoders disagree about trailing silence and containers round
    // differently, so identical films routinely differ by a fraction.
    expect(filmsMatch(local(7402.0), local(7402.4))).toBe(true);
  });

  it("catches two different films", () => {
    expect(filmsMatch(local(7402), local(5460))).toBe(false);
  });

  it("catches a difference either way round", () => {
    expect(filmsMatch(local(5460), local(7402))).toBe(false);
  });

  it("never accuses anyone while a length is still unknown", () => {
    // A file that has not reported its metadata is not evidence of a mismatch,
    // and saying so while their video is still loading is worse than silence.
    expect(filmsMatch(local(null), local(7402))).toBe(true);
    expect(filmsMatch(local(7402), local(null))).toBe(true);
  });

  it("has nothing to check on YouTube", () => {
    // Both sides fetch the same id, so they cannot have opened different things.
    const yt = { videoId: "abc", source: "youtube" as const, durationSec: 100 };
    const other = { videoId: "abc", source: "youtube" as const, durationSec: 9999 };
    expect(filmsMatch(yt, other)).toBe(true);
  });

  it("tolerates less than a cut but more than a rounding", () => {
    expect(DURATION_MATCH_SEC).toBeGreaterThan(0.5);
    expect(DURATION_MATCH_SEC).toBeLessThan(30);
  });
});

describe("rampPlan", () => {
  it("slows an ahead player just long enough to lose the error", () => {
    expect(rampPlan(0.18)).toEqual({ rate: 1 - RAMP_RATE, forSec: 6 });
  });

  it("speeds a behind player just long enough to gain the error", () => {
    expect(rampPlan(-0.18)).toEqual({ rate: 1 + RAMP_RATE, forSec: 6 });
  });

  it("does not chase errors inside the drift tolerance", () => {
    expect(rampPlan(DRIFT_TOLERANCE_SEC)).toBeNull();
  });

  it("uses a ramp at its longest useful boundary", () => {
    expect(rampPlan(RAMP_RATE * MAX_RAMP_SEC)).toEqual({
      rate: 1 - RAMP_RATE,
      forSec: MAX_RAMP_SEC,
    });
  });

  it("seeks instead once a ramp would outlast its useful window", () => {
    expect(rampPlan(RAMP_RATE * MAX_RAMP_SEC + 0.001)).toBeNull();
  });
});

describe("toleranceFor", () => {
  it("holds a song to a third of a beat", () => {
    expect(toleranceFor("singing")).toBe(SINGING_TOLERANCE_SEC);
  });

  it("gives a film far more room than a song", () => {
    expect(toleranceFor("watching")).toBeGreaterThan(toleranceFor("singing"));
  });

  /**
   * The number that matters. On YouTube every correction is a seek, and a
   * seek is a stop-and-restart -- so a film policed to singing precision
   * stutters roughly every time two independent players wobble apart, in
   * exchange for closing a gap nobody watching could have perceived.
   */
  it("lets a film drift half a second before interrupting anyone", () => {
    expect(toleranceFor("watching")).toBeGreaterThanOrEqual(0.4);
  });

  it("defaults the shared constant to the tighter of the two", () => {
    expect(DRIFT_TOLERANCE_SEC).toBe(SINGING_TOLERANCE_SEC);
  });
});

describe("needsCorrection with an explicit tolerance", () => {
  const watching = toleranceFor("watching");

  it("leaves a film alone at a gap that would move a song", () => {
    expect(needsCorrection(30, 30.3)).toBe(true);
    expect(needsCorrection(30, 30.3, watching)).toBe(false);
  });

  it("still corrects a film once it is genuinely adrift", () => {
    expect(needsCorrection(30, 31.2, watching)).toBe(true);
  });

  it("measures the gap in both directions", () => {
    expect(needsCorrection(30.3, 30, watching)).toBe(false);
    expect(needsCorrection(31.2, 30, watching)).toBe(true);
  });

  it("treats a gap exactly on the tolerance as acceptable", () => {
    expect(needsCorrection(30, 30 + watching, watching)).toBe(false);
  });
});

describe("rampPlan with an explicit tolerance", () => {
  const watching = toleranceFor("watching");

  it("declines to chase a gap a film is allowed to have", () => {
    expect(rampPlan(0.3, watching)).toBeNull();
  });

  /**
   * The property that makes a film never change speed, and it falls out of
   * the two numbers rather than needing a rule of its own: the largest error
   * a ramp can absorb is RAMP_RATE * MAX_RAMP_SEC, which is smaller than the
   * gap a film is allowed to have in the first place. So every error big
   * enough to act on is already too big to ramp, and a film is only ever
   * corrected by moving the playhead -- never by running fast or slow.
   */
  it("can never ramp a film, because the ramp window fits inside the tolerance", () => {
    expect(RAMP_RATE * MAX_RAMP_SEC).toBeLessThan(watching);
    for (const error of [0.51, 0.6, 1, 2, 5, -0.51, -0.6, -1, -5]) {
      expect(rampPlan(error, watching)).toBeNull();
    }
  });

  it("keeps the singing tolerance when none is given", () => {
    expect(rampPlan(0.3)).toEqual(rampPlan(0.3, SINGING_TOLERANCE_SEC));
  });
});
