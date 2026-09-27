"use client";

import { useEffect, useRef } from "react";

/**
 * Natural voice is where karaoke starts: switched on once each time karaoke
 * opens, and then left to whoever is holding the switch.
 *
 * Once, not whenever it is off. Turning it off has to stick for the rest of
 * that karaoke, and a laptop that refuses the echo canceller in this mode
 * hands the normal microphone back -- asking again on every render would
 * reopen the microphone in a loop.
 */
export function useNaturalVoiceDefault(
  karaoke: boolean,
  turnOn: () => void,
): void {
  const done = useRef(false);
  const turnOnRef = useRef(turnOn);
  useEffect(() => {
    turnOnRef.current = turnOn;
  });

  useEffect(() => {
    if (!karaoke) {
      done.current = false;
      return;
    }
    if (done.current) return;
    done.current = true;
    turnOnRef.current();
  }, [karaoke]);
}
