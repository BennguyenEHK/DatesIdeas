"use client";

import { useEffect, useRef, useState } from "react";

/**
 * How long one singer must be quiet before a duet counts as over.
 *
 * Longer than any breath or gap between lines, which is what used to end a
 * duet: the detector lets a voice go after 2.5 seconds of quiet, every breath
 * then looked like a solo, and each flip re-timed both players under a fade --
 * the beat going "compressed and faded" every few seconds. Short enough that a
 * real solo section inside a duet song is still re-timed for its listener.
 */
export const DUET_RELEASE_MS = 8000;

/**
 * The singing detector's answer, held steady through a duet.
 *
 * Before the two of you have sung at the same moment, this is the detector
 * unchanged, so solo turn-taking works exactly as before. From that moment it
 * reports both of you singing until either has been quiet for
 * DUET_RELEASE_MS, or the song stops. Only the timing of re-times changes;
 * how big each one is, and the anchor and follower arrangement, do not.
 */
export function useDuetHold(
  mine: boolean,
  theirs: boolean,
  /** A song is playing in karaoke. A stopped song ends any duet at once. */
  live: boolean,
): { mine: boolean; theirs: boolean } {
  const [duet, setDuet] = useState(false);

  // Adjusted while rendering, React's pattern for state that follows props:
  // the duet has to be known in the same render the second voice arrives,
  // or the turn rules see one render of "solo" and move the music for it.
  if (live && mine && theirs && !duet) setDuet(true);
  if (!live && duet) setDuet(false);

  // When each singer fell quiet. Counted from the first to go quiet, so a
  // duet where both stop ends DUET_RELEASE_MS after the first did.
  const mineQuietAt = useRef<number | null>(null);
  const theirsQuietAt = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    mineQuietAt.current = mine ? null : (mineQuietAt.current ?? now);
    theirsQuietAt.current = theirs ? null : (theirsQuietAt.current ?? now);
    if (!duet) return;

    const quiet = [mineQuietAt.current, theirsQuietAt.current].filter(
      (at): at is number => at !== null,
    );
    if (quiet.length === 0) return;
    const wait = Math.max(0, Math.min(...quiet) + DUET_RELEASE_MS - now);
    const id = setTimeout(() => setDuet(false), wait);
    return () => clearTimeout(id);
  }, [mine, theirs, duet]);

  return duet && live ? { mine: true, theirs: true } : { mine, theirs };
}
