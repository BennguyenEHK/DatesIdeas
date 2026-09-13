import { civilDate } from "./occasions";
import type { AlbumItem, TimeZone } from "./types";

/**
 * Play the day: the timing of the little film, as pure functions.
 *
 * The film component draws whatever `segmentAt` says for the elapsed time it is
 * given, and nothing else decides where the film is. That is what lets two
 * screens in a call show the same moment: they share a `FilmState` and a clock,
 * and each computes the same elapsed time from them.
 */

/** The title card. */
export const TITLE_MS = 2500;
/** Each memory. */
export const SLIDE_MS = 3500;
/** The crossfade at each end of a memory, drawn inside SLIDE_MS. */
export const FADE_MS = 800;
/** The closing card. */
export const END_MS = 2500;

/** A slow zoom and pan across one memory: scale, and offset in percent of the frame. */
export interface Motion {
  fromScale: number;
  toScale: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const MOTIONS: readonly Motion[] = [
  { fromScale: 1, toScale: 1.12, fromX: 0, fromY: 0, toX: -3, toY: -2 },
  { fromScale: 1.12, toScale: 1, fromX: -3, fromY: 2, toX: 2, toY: 0 },
  { fromScale: 1, toScale: 1.1, fromX: 2, fromY: -2, toX: -2, toY: 2 },
  { fromScale: 1.1, toScale: 1.02, fromX: 0, fromY: 0, toX: 3, toY: -3 },
];

/** The motion for the memory at a position. Cycles, so neighbours never move alike. */
export function motionFor(index: number): Motion {
  const at = ((Math.trunc(index) % MOTIONS.length) + MOTIONS.length) % MOTIONS.length;
  return MOTIONS[at];
}

export type Segment =
  | { kind: "title"; startMs: number; durationMs: number }
  | { kind: "memory"; index: number; itemId: string; startMs: number; durationMs: number; motion: Motion }
  | { kind: "end"; startMs: number; durationMs: number };

export interface Film {
  segments: Segment[];
  totalMs: number;
}

/** The film for a day's memories, already in play order. */
export function filmSchedule(itemIds: readonly string[]): Film {
  const segments: Segment[] = [{ kind: "title", startMs: 0, durationMs: TITLE_MS }];
  itemIds.forEach((itemId, index) => {
    segments.push({
      kind: "memory",
      index,
      itemId,
      startMs: TITLE_MS + index * SLIDE_MS,
      durationMs: SLIDE_MS,
      motion: motionFor(index),
    });
  });
  const endStart = TITLE_MS + itemIds.length * SLIDE_MS;
  segments.push({ kind: "end", startMs: endStart, durationMs: END_MS });
  return { segments, totalMs: endStart + END_MS };
}

/**
 * What is on screen at an elapsed time, and how far through it.
 *
 * Before the start holds on the title card. At or after the end returns null:
 * the film is over.
 */
export function segmentAt(
  film: Film,
  elapsedMs: number,
): { segment: Segment; position: number; progress: number } | null {
  const at = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (at >= film.totalMs) return null;
  for (let position = film.segments.length - 1; position >= 0; position -= 1) {
    const segment = film.segments[position];
    if (at >= segment.startMs) {
      return { segment, position, progress: (at - segment.startMs) / segment.durationMs };
    }
  }
  return null;
}

/** Where "previous" and "next" jump to from an elapsed time: the start of a neighbouring segment. */
export function neighbourStart(film: Film, elapsedMs: number, direction: -1 | 1): number {
  const current = segmentAt(film, elapsedMs);
  const position = current === null ? film.segments.length : current.position;
  // Previous from well inside a segment restarts it, the way a music player does.
  if (direction === -1 && current !== null && current.progress > 0.25) return current.segment.startMs;
  const target = film.segments[position + direction];
  if (target === undefined) return direction === -1 ? 0 : film.totalMs;
  return target.startMs;
}

/** A day's memories in play order: earliest first. `day` is YYYY-MM-DD in `timeZone`. */
export function dayItems(items: readonly AlbumItem[], day: string, timeZone: TimeZone): AlbumItem[] {
  return items
    .filter((item) => civilDate(item.happenedAt, timeZone) === day)
    .sort((left, right) => {
      const order = Date.parse(left.happenedAt) - Date.parse(right.happenedAt);
      return order !== 0 ? order : left.id.localeCompare(right.id);
    });
}

/**
 * What is playing, as data both screens can hold.
 *
 * `anchorMs` is the clock instant at which elapsed time was zero. `pausedAtMs`
 * is the elapsed time the film is frozen at, or null while it plays.
 */
export interface FilmState {
  day: string;
  anchorMs: number;
  pausedAtMs: number | null;
}

export function startFilm(day: string, atMs: number): FilmState {
  return { day, anchorMs: atMs, pausedAtMs: null };
}

/** Elapsed time on a clock. Holds at zero until the anchor, so a scheduled start waits. */
export function filmElapsed(film: FilmState, nowMs: number): number {
  return film.pausedAtMs ?? Math.max(0, nowMs - film.anchorMs);
}

export function pauseFilm(film: FilmState, nowMs: number): FilmState {
  if (film.pausedAtMs !== null) return film;
  return { ...film, pausedAtMs: filmElapsed(film, nowMs) };
}

export function resumeFilm(film: FilmState, nowMs: number): FilmState {
  if (film.pausedAtMs === null) return film;
  return { day: film.day, anchorMs: nowMs - film.pausedAtMs, pausedAtMs: null };
}

export function seekFilm(film: FilmState, elapsedMs: number, nowMs: number): FilmState {
  const at = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  return film.pausedAtMs !== null
    ? { ...film, pausedAtMs: at }
    : { ...film, anchorMs: nowMs - at };
}
