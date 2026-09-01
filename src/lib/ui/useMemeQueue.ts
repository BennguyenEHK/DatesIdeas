"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MemeId } from "@/lib/rtc/protocol";

export interface ActiveMeme {
  key: number;
  id: MemeId;
}

/** Pop-in, then the hold the design asks for. The fade after this is the overlay's exit. */
export const MEME_POP_MS = 150;
export const MEME_HOLD_MS = 2200;
export const MEME_VISIBLE_MS = MEME_POP_MS + MEME_HOLD_MS;

/**
 * Holds the memes currently on screen and expires them on a timer.
 *
 * One queue, not one per side: a reaction is shown on both video tiles at
 * once, so there is nothing to keep separate. Keys are monotonic rather than
 * derived from the meme id, so firing the same gesture twice animates twice
 * instead of the second one silently replacing the first.
 */
export function useMemeQueue(visibleMs: number = MEME_VISIBLE_MS) {
  const [memes, setMemes] = useState<ActiveMeme[]>([]);
  const keyRef = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const show = useCallback(
    (id: MemeId) => {
      const key = keyRef.current++;
      setMemes((cur) => [...cur, { key, id }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setMemes((cur) => cur.filter((m) => m.key !== key));
      }, visibleMs);
      timers.current.add(timer);
    },
    [visibleMs],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { memes, show };
}
