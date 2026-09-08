"use client";

import { useEffect, useRef, useState } from "react";
import {
  DIM_DEPTH,
  DIM_DOWN_MS,
  DIM_UP_MS,
  levelAt,
  nextState,
  type HouseState,
} from "@/lib/ui/houseLights";

/**
 * The room's house lights, kept as a layer above the ground and letterbox bars
 * but below the stage. The stage is the only place the film can render, so the
 * fixed layer uses z-1 while `.stage` establishes z-2 in globals.css. That
 * leaves the picture untouched and still lets the layer cover the room around
 * it; Blackout remains at z-50 and therefore still wins when the room closes.
 */
export function HouseLights({ playing }: { playing: boolean }) {
  const [state, setState] = useState<HouseState>(() => (playing ? "dimming" : "up"));
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [startingLevel, setStartingLevel] = useState(() => (playing ? 0 : 0));
  const stateRef = useRef(state);
  const startedAtRef = useRef(startedAt);
  const startingLevelRef = useRef(startingLevel);

  useEffect(() => {
    const now = Date.now();
    const currentLevel = levelAt(
      stateRef.current,
      now - startedAtRef.current,
      startingLevelRef.current,
    );
    const next = nextState(playing, stateRef.current);

    if (next === stateRef.current) return;

    stateRef.current = next;
    startedAtRef.current = now;
    startingLevelRef.current = currentLevel;
    setState(next);
    setStartedAt(now);
    setStartingLevel(currentLevel);
  }, [playing]);

  useEffect(() => {
    if (state !== "dimming" && state !== "rising") return;

    const duration = state === "dimming" ? DIM_DOWN_MS : DIM_UP_MS;
    const remaining = Math.max(0, duration * (state === "dimming" ? 1 - startingLevel : startingLevel));
    const timer = window.setTimeout(() => {
      const settled: HouseState = state === "dimming" ? "down" : "up";
      stateRef.current = settled;
      startedAtRef.current = Date.now();
      startingLevelRef.current = state === "dimming" ? 1 : 0;
      setState(settled);
      setStartedAt(startedAtRef.current);
      setStartingLevel(startingLevelRef.current);
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [state, startedAt, startingLevel]);

  const level = state === "up" ? 0 : state === "down" ? 1 : state === "dimming" ? 1 : 0;

  // Only the remaining distance is travelled when a fade is interrupted, so the
  // transition has to be shortened to match. At full length the room would go
  // on drifting for seconds after the state machine had already called itself
  // settled -- pausing halfway down and pressing play again would then find the
  // lights still moving under a machine that thought they had stopped.
  const full = state === "dimming" ? DIM_DOWN_MS : DIM_UP_MS;
  const distance =
    state === "dimming"
      ? 1 - startingLevel
      : state === "rising"
        ? startingLevel
        : 1;

  return (
    <div
      aria-hidden="true"
      data-testid="house-lights"
      className="house-lights fixed inset-0 z-[1] pointer-events-none bg-[var(--letterbox)]"
      style={{
        opacity: level * DIM_DEPTH,
        transitionDuration: `${Math.round(full * distance)}ms`,
      }}
    />
  );
}
