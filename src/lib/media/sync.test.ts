import { describe, it, expect } from "vitest";
import {
  targetPosition,
  needsCorrection,
  stateAt,
  DRIFT_TOLERANCE_SEC,
  type PlaybackState,
} from "./sync";
import { youTubeId, youTubeStart } from "./youtube";

const playing: PlaybackState = {
  videoId: "dQw4w9WgXcQ",
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
    expect(stateAt("abc12345678", 12.5, true, 50_000)).toEqual({
      videoId: "abc12345678",
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
