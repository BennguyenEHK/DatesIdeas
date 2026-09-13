"use client";

import type { AlbumItem } from "@/lib/album/types";

/**
 * Play the day: one day's memories as a little film. PLACEHOLDER -- the
 * interface is fixed; the body is being built.
 *
 * Fully controlled. Where the film is comes only from `elapsedMs()`, read on
 * every animation frame, and the schedule in `src/lib/album/film.ts`. The
 * owner holds the FilmState: the album page on the local clock, the call on
 * the shared one.
 */
export interface DayFilmProps {
  /** The day's memories, in play order (see `dayItems`). */
  items: AlbumItem[];
  /** The title card's main line, e.g. "Saturday, 3 September 2026". */
  title: string;
  /** An occasion's title for that day, or null. */
  subtitle: string | null;
  /** The closing card's words: the day's first caption, or null for the date. */
  closing: string | null;
  /** Current elapsed time in ms. Called every animation frame; cheap. */
  elapsedMs: () => number;
  /** False while paused. */
  playing: boolean;
  onPause: () => void;
  onResume: () => void;
  /** Jump to an elapsed time. */
  onSeek: (elapsedMs: number) => void;
  /** Close the film. Also called once when the film reaches its end. */
  onClose: () => void;
}

export function DayFilm({ onClose }: DayFilmProps) {
  return (
    <div role="dialog" aria-label="Play the day" className="fixed inset-0 z-50 bg-black">
      <button type="button" onClick={onClose} className="m-4 text-[var(--lamp)]">
        Close
      </button>
    </div>
  );
}
