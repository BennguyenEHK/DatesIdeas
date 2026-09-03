"use client";

import { useCallback, useEffect, useRef } from "react";
import { duckPlan, duckSilentAtMs, duckTotalMs } from "./duck";
import type { PlayerHandle } from "./player";

/**
 * Hides an unavoidable jump in the music under a short dip in volume.
 *
 * The delay that lines up someone's singing can only be applied to a YouTube
 * player by seeking, because the API rounds any playback rate it does not
 * support back to 1 — so there is no way to glide into the new position, only
 * to jump to it. A jump stops and restarts the decoder, which is the lurch
 * that made every change of turn audible.
 *
 * Since the jump cannot be made smooth, it is made inaudible instead: fade
 * down, move while nothing can be heard, fade back up. A DJ crossfading
 * rather than yanking the record off.
 */
export function useVolumeDuck(
  player: PlayerHandle | null,
  /** The volume to return to — read live, so a slider moved mid-dip wins. */
  volume: number,
): (apply: () => void) => void {
  // Declared above the callback that writes them: the React Compiler refuses a
  // ref first modified inside a closure declared below it.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playerRef = useRef(player);
  const volumeRef = useRef(volume);
  useEffect(() => {
    playerRef.current = player;
    volumeRef.current = volume;
  });

  useEffect(() => {
    // Copied by reference deliberately: the array is only ever pushed to and
    // emptied in place, never reassigned, so this is the same array at unmount.
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
    };
  }, []);

  return useCallback((apply: () => void) => {
    const p = playerRef.current;
    // Nothing is playing, so there is no lurch to hide and no reason to make
    // anyone wait a third of a second for a change that is already silent.
    if (!p?.isReady()) {
      apply();
      return;
    }

    // A second dip starting on top of a first would fight it for the volume
    // and could strand the music quiet. The newest turn is the true one.
    for (const id of timers.current) clearTimeout(id);
    timers.current.length = 0;

    for (const step of duckPlan(volumeRef.current)) {
      timers.current.push(
        setTimeout(() => playerRef.current?.setVolume(step.volume), step.atMs),
      );
    }

    // The move itself, in the middle of the silence.
    timers.current.push(setTimeout(apply, duckSilentAtMs()));

    // Land on whatever the volume is by the time the dip ends, rather than on
    // the figure captured when it began. Otherwise turning the music up
    // during those two thirds of a second is undone the moment it finishes.
    timers.current.push(
      setTimeout(
        () => playerRef.current?.setVolume(volumeRef.current),
        duckTotalMs() + 1,
      ),
    );
  }, []);
}
