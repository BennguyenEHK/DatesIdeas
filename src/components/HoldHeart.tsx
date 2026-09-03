"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** How long a full hold takes. Deliberate, but nobody's arm gets tired. */
export const FILL_MS = 1100;
/** Letting go should feel like letting go, so it falls faster than it rose. */
export const DRAIN_MS = 450;
/** A beat of light before anything happens, so the moment lands. */
const BLOOM_MS = 260;

/** Seconds per beat at rest and at the brim. A heart near full beats faster. */
const BEAT_SLOW = 0.9;
const BEAT_FAST = 0.42;

/**
 * The vessel. Bottom point at y=88, top of the lobes at y=8.
 *
 * The surface is driven a little ABOVE the lobes at full, because the wave has
 * a trough as well as a crest: stopping exactly at the top left a dark notch
 * between the two lobes on a heart that was supposed to be brimming.
 */
const HEART =
  "M50 88C50 88 8 60 8 33C8 18 20 8 32 8C41 8 47 13 50 18C53 13 59 8 68 8C80 8 92 18 92 33C92 60 50 88 50 88Z";
const TOP = 8;
/** Where the surface sits at full, clear of the wave’s own trough. */
const BRIM = TOP - 8;
const BOTTOM = 88;

/**
 * A wave wide enough to slide sideways underneath the heart without its ends
 * ever showing. Crest at y=0; everything below is filled.
 */
const WAVE =
  "M-50 0Q-37.5 -5 -25 0T0 0T25 0T50 0T75 0T100 0T125 0T150 0L150 130L-50 130Z";

type Stage = "idle" | "holding" | "done";

/**
 * Hold the heart until the gold reaches the top, and it keeps the picture.
 *
 * A hold rather than a tap, because this is the moment somebody decides to
 * keep an evening — and because filling something is a better thing to watch
 * than a spinner. It also means nobody saves twice by accident.
 *
 * The fill is driven straight into the DOM from one animation loop rather than
 * through React state: sixty renders a second to move a wave is work nobody
 * asked for, and the stutter would show in the very thing it is animating.
 */
export function HoldHeart({
  onPrime,
  onComplete,
  label,
  hint,
  busy = false,
  disabled = false,
}: {
  /** Fired the instant the hold begins, to start fetching in parallel. */
  onPrime?: () => void;
  /** Fired once the heart is full. */
  onComplete: () => void;
  /** The accessible name — what holding this will do. */
  label: string;
  /** The line beneath. */
  hint: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState<Stage>("idle");

  // Every ref above the callbacks that write to them: the React Compiler
  // refuses a ref first modified inside a closure declared below it.
  const liquidRef = useRef<SVGGElement>(null);
  const waveRef = useRef<SVGGElement>(null);
  const wave2Ref = useRef<SVGGElement>(null);
  const heartRef = useRef<SVGGElement>(null);
  const rimRef = useRef<SVGPathElement>(null);
  const fill = useRef(0);
  const holding = useRef(false);
  const phase = useRef(0);
  const drift = useRef(0);
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const calmRef = useRef(reduceMotion ?? false);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    calmRef.current = reduceMotion ?? false;
  });

  const paint = useCallback(() => {
    const p = fill.current;
    const calm = calmRef.current;

    // The surface rides from the point of the heart to the top of its lobes.
    const surface = BOTTOM - p * (BOTTOM - BRIM);
    if (liquidRef.current) {
      liquidRef.current.setAttribute("transform", `translate(0 ${surface})`);
    }
    // Two crests at different speeds, which is what stops it reading as a bar
    // with a wiggle drawn on top.
    if (waveRef.current) {
      waveRef.current.setAttribute("transform", `translate(${drift.current} 0)`);
    }
    if (wave2Ref.current) {
      wave2Ref.current.setAttribute(
        "transform",
        `translate(${-drift.current * 0.62} 1.5)`,
      );
    }
    // The glow belongs to the gold, not to the outline: an empty heart casts
    // no light, and a full one lights the page around it.
    if (heartRef.current) {
      const beat = calm ? 0 : Math.max(0, Math.sin(phase.current * Math.PI * 2));
      const scale = 1 + beat * beat * (0.055 + p * 0.045);
      heartRef.current.style.transform = `scale(${scale})`;
      heartRef.current.style.filter =
        p > 0.01
          ? `drop-shadow(0 0 ${2 + p * 10}px rgba(242,194,48,${0.25 + p * 0.5}))`
          : "none";
    }
    if (rimRef.current) {
      rimRef.current.style.stroke = `rgba(245,239,224,${0.24 + p * 0.5})`;
    }
  }, []);

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  /**
   * One loop drives the fill, the beat, the wave and the glow together.
   *
   * Declared inside `run` as a plain function rather than as a hook value so
   * it can name itself for the next frame: a useCallback that schedules itself
   * would be reading its own binding before it exists.
   */
  const run = useCallback(() => {
    if (raf.current !== null) return;
    last.current = 0;

    const loop = (now: number) => {
      const dt = last.current === 0 ? 16 : Math.min(now - last.current, 64);
      last.current = now;

      // The beat quickens as it fills. A constant one would be decoration;
      // this one tells you how close you are without showing a number.
      const rate = 1 / (BEAT_SLOW - (BEAT_SLOW - BEAT_FAST) * fill.current);
      phase.current = (phase.current + (dt / 1000) * rate) % 1;
      if (!calmRef.current) drift.current = (drift.current - dt * 0.012) % 50;

      const step = dt / (holding.current ? FILL_MS : -DRAIN_MS);
      fill.current = Math.min(1, Math.max(0, fill.current + step));
      paint();

      if (fill.current >= 1 && !completed.current) {
        completed.current = true;
        holding.current = false;
        stop();
        setStage("done");
        // A beat of light first, then the thing itself. Firing on the frame it
        // fills makes the filling feel like it was never the point.
        window.setTimeout(() => onCompleteRef.current(), BLOOM_MS);
        return;
      }
      if (!holding.current && fill.current <= 0) {
        stop();
        setStage("idle");
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);
  }, [paint, stop]);

  const press = useCallback(() => {
    if (disabled || busy || completed.current) return;
    holding.current = true;
    setStage("holding");
    onPrime?.();
    run();
  }, [disabled, busy, onPrime, run]);

  const release = useCallback(() => {
    if (completed.current) return;
    holding.current = false;
    run();
  }, [run]);

  useEffect(() => stop, [stop]);

  // Reset after a finished save so the same heart can be held again.
  useEffect(() => {
    if (busy || stage !== "done") return;
    const id = window.setTimeout(() => {
      completed.current = false;
      fill.current = 0;
      paint();
      setStage("idle");
    }, 1600);
    return () => window.clearTimeout(id);
  }, [busy, stage, paint]);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        // Space and Enter held down, for anyone not using a pointer. Key
        // repeat is ignored so the hold is one continuous press.
        onKeyDown={(e) => {
          if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
          e.preventDefault();
          press();
        }}
        onKeyUp={(e) => {
          if (e.key !== " " && e.key !== "Enter") return;
          release();
        }}
        onBlur={release}
        className="group relative touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--lamp)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--letterbox)] disabled:opacity-40"
      >
        <svg
          // Padded viewBox, not a 0 0 100 100 one: the glow is a filter, and a
          // filter is clipped to the SVG's own box. Without the margin the
          // light around a full heart ends in a hard square edge.
          viewBox="-20 -20 140 140"
          className="h-36 w-36 select-none overflow-visible"
        >
          <defs>
            <clipPath id="hh-heart">
              <path d={HEART} />
            </clipPath>
            <linearGradient id="hh-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f6d270" />
              <stop offset="0.45" stopColor="#f2c230" />
              <stop offset="1" stopColor="#c98f16" />
            </linearGradient>
          </defs>

          <g ref={heartRef} style={{ transformOrigin: "50px 52px" }}>
            {/* The vessel: dark, so an empty heart reads as waiting rather
                than as broken. */}
            <path d={HEART} fill="rgba(245,239,224,0.05)" />

            <g clipPath="url(#hh-heart)">
              <g ref={liquidRef}>
                <g ref={wave2Ref} opacity="0.45">
                  <path d={WAVE} fill="url(#hh-gold)" />
                </g>
                <g ref={waveRef}>
                  <path d={WAVE} fill="url(#hh-gold)" />
                </g>
              </g>
            </g>

            <path
              ref={rimRef}
              d={HEART}
              fill="none"
              strokeWidth="2"
              style={{ stroke: "rgba(245,239,224,0.24)" }}
            />
          </g>
        </svg>

        {/* The bloom: one soft flare as it fills, then gone. */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full bg-[var(--dress)] transition-opacity duration-300 ${
            stage === "done" ? "opacity-25 blur-2xl" : "opacity-0"
          }`}
        />
      </button>

      <p className="text-center text-[0.7rem] leading-relaxed text-[var(--mist)]">
        {busy ? "Keeping it…" : hint}
      </p>
    </div>
  );
}
