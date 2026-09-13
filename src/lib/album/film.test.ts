import { describe, expect, it } from "vitest";
import {
  END_MS,
  SLIDE_MS,
  TITLE_MS,
  dayItems,
  filmElapsed,
  filmSchedule,
  motionFor,
  neighbourStart,
  pauseFilm,
  resumeFilm,
  seekFilm,
  segmentAt,
  startFilm,
} from "./film";
import type { AlbumItem } from "./types";

function item(id: string, happenedAt: string): AlbumItem {
  return {
    id,
    kind: "photo",
    contentType: "image/jpeg",
    bytes: 1,
    happenedAt,
    createdAt: happenedAt,
    caption: null,
    loved: false,
    sourceRoom: null,
    url: `https://x/${id}`,
    posterUrl: null,
  };
}

describe("filmSchedule", () => {
  it("is a title, each memory in order, then an ending", () => {
    const film = filmSchedule(["a", "b", "c"]);
    expect(film.segments.map((s) => (s.kind === "memory" ? s.itemId : s.kind))).toEqual([
      "title",
      "a",
      "b",
      "c",
      "end",
    ]);
    expect(film.totalMs).toBe(TITLE_MS + 3 * SLIDE_MS + END_MS);
  });

  it("gives neighbouring memories different motion", () => {
    expect(motionFor(0)).not.toEqual(motionFor(1));
    expect(motionFor(4)).toEqual(motionFor(0));
    expect(motionFor(-1)).toEqual(motionFor(3));
  });
});

describe("segmentAt", () => {
  const film = filmSchedule(["a", "b"]);

  it("holds on the title before and at the start", () => {
    expect(segmentAt(film, -500)?.segment.kind).toBe("title");
    expect(segmentAt(film, 0)?.segment.kind).toBe("title");
  });

  it("finds the memory and how far through it", () => {
    const at = segmentAt(film, TITLE_MS + SLIDE_MS + SLIDE_MS / 2);
    expect(at?.segment.kind === "memory" && at.segment.itemId).toBe("b");
    expect(at?.progress).toBeCloseTo(0.5);
  });

  it("is over at the end", () => {
    expect(segmentAt(film, film.totalMs - 1)?.segment.kind).toBe("end");
    expect(segmentAt(film, film.totalMs)).toBeNull();
  });

  it("treats a broken elapsed time as the start rather than throwing", () => {
    expect(segmentAt(film, Number.NaN)?.segment.kind).toBe("title");
  });
});

describe("neighbourStart", () => {
  const film = filmSchedule(["a", "b"]);

  it("jumps forward to the next segment", () => {
    expect(neighbourStart(film, 100, 1)).toBe(TITLE_MS);
    expect(neighbourStart(film, TITLE_MS + 10, 1)).toBe(TITLE_MS + SLIDE_MS);
  });

  it("restarts the current memory when well into it, otherwise goes back one", () => {
    expect(neighbourStart(film, TITLE_MS + SLIDE_MS * 0.6, -1)).toBe(TITLE_MS);
    expect(neighbourStart(film, TITLE_MS + SLIDE_MS + 10, -1)).toBe(TITLE_MS);
    expect(neighbourStart(film, 10, -1)).toBe(0);
  });
});

describe("dayItems", () => {
  it("keeps one day in the viewer's time zone, earliest first", () => {
    const items = [
      item("late", "2026-09-13T03:30:00.000Z"), // 10:30 pm on the 12th in Chicago
      item("early", "2026-09-12T15:00:00.000Z"),
      item("next", "2026-09-13T15:00:00.000Z"),
    ];
    expect(dayItems(items, "2026-09-12", "America/Chicago").map((i) => i.id)).toEqual([
      "early",
      "late",
    ]);
  });
});

describe("film state", () => {
  it("counts from its anchor and waits at zero before it", () => {
    const film = startFilm("2026-09-12", 1000);
    expect(filmElapsed(film, 800)).toBe(0);
    expect(filmElapsed(film, 4000)).toBe(3000);
  });

  it("freezes on pause and carries on from there on resume", () => {
    const paused = pauseFilm(startFilm("2026-09-12", 1000), 4000);
    expect(filmElapsed(paused, 99_999)).toBe(3000);
    const resumed = resumeFilm(paused, 10_000);
    expect(filmElapsed(resumed, 10_500)).toBe(3500);
    expect(pauseFilm(paused, 50_000)).toBe(paused);
    expect(resumeFilm(resumed, 50_000)).toBe(resumed);
  });

  it("seeks while playing and while paused", () => {
    const playing = seekFilm(startFilm("2026-09-12", 0), 7000, 20_000);
    expect(filmElapsed(playing, 20_000)).toBe(7000);
    const paused = seekFilm(pauseFilm(playing, 21_000), 2000, 30_000);
    expect(filmElapsed(paused, 99_000)).toBe(2000);
    expect(filmElapsed(seekFilm(paused, -50, 0), 0)).toBe(0);
  });
});
