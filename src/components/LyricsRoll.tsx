"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { lineIndexAt, type LrcLine } from "@/lib/karaoke/lrc";

export function LyricsRoll(props: {
  /** Parsed lyrics, already sorted by time. Empty when there are none. */
  lines: readonly LrcLine[];
  /** Reads the playhead, in seconds. Called on every animation frame. */
  positionSec: () => number;
  /** True while the song is stopped, so the loop can rest. */
  paused: boolean;
}): React.JSX.Element {
  const { lines, positionSec, paused } = props;
  const reduceMotion = useReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const lastIndex = useRef(-1);

  useEffect(() => {
    if (paused || lines.length === 0) return;

    let active = true;
    let frame: number | null = null;

    // A plain local function can name itself for the next frame without
    // creating the self-referential useCallback that the React Compiler rejects.
    const loop = () => {
      if (!active) return;

      const nextIndex = lineIndexAt(lines, positionSec());
      if (nextIndex !== lastIndex.current) {
        lastIndex.current = nextIndex;
        // React state changes only when the lyric line changes; moving the
        // playhead within one line does not need sixty renders per second.
        setCurrentIndex(nextIndex);
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);

    return () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [lines, paused, positionSec]);

  if (lines.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6 text-center">
        <p className="text-[0.7rem] leading-relaxed text-[var(--mist)]">
          No lyrics loaded — the song still plays. Add an .lrc file from Change
          song to follow the words.
        </p>
      </div>
    );
  }

  const firstVisible = currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1);
  const visibleLines = lines.slice(firstVisible, firstVisible + 4);
  const transition = reduceMotion ? "" : "transition-colors duration-300";

  return (
    // The live region is this container, which never unmounts, rather than the
    // lit line itself. A region that arrives at the same moment as its content
    // is not announced at all: a screen reader reports CHANGES inside a region
    // it was already watching, so a fresh element each line is silent.
    <div
      aria-live="polite"
      className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center leading-relaxed"
    >
      {visibleLines.map((line, offset) => {
        const index = firstVisible + offset;
        const current = index === currentIndex;
        return (
          <p
            key={`${line.atSec}-${index}`}
            // Everything but the lit line is hidden from the reader, so moving
            // one line does not re-announce the whole verse.
            aria-hidden={current ? undefined : "true"}
            className={
              current
                ? `text-lg font-medium text-[var(--cream)] ${transition}`
                : `text-sm text-[var(--mist)]/70 ${transition}`
            }
          >
            {line.text}
          </p>
        );
      })}
    </div>
  );
}
