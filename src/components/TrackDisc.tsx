"use client";

import { motion, useReducedMotion } from "motion/react";

export type DiscState = "absent" | "loading" | "held";

export interface TrackDiscProps {
  /** "absent" renders nothing at all (return null). */
  state: DiscState;
  /** The ONLY thing that drives rotation. */
  playing: boolean;
  /** Song title shown beside the disc. Null while loading. */
  title: string | null;
  /** Decoded length in seconds. 0 when unknown. */
  durationSec: number;
  /** "md" (default) suits a roomy panel; "sm" fits a compact control row. */
  size?: "sm" | "md";
}

/**
 * A vinyl record that shows whether audio is loaded and whether it is playing.
 *
 * The disc APPEARING signals the audio is decoded and held in memory. The disc
 * TURNING signals it is playing. These are two separate state signals, never
 * conflated: a loading disc never rotates, no matter what the playing prop says.
 * Rotation is bound solely to the playing prop; loading is purely visual and static.
 *
 * La La Land theme: disc body in letterbox blue, gold label, hairline grooves.
 */
export function TrackDisc(props: TrackDiscProps) {
  const { state, playing, title, durationSec, size = "md" } = props;
  const reduceMotion = useReducedMotion();

  if (state === "absent") {
    return null;
  }

  const isLoading = state === "loading";
  const isHeld = state === "held";
  const isCompact = size === "sm";

  /**
   * Whether the record is actually turning.
   *
   * Deliberately the one place this is decided. A disc turns because audio is
   * moving -- never because something is loading, and never when someone has
   * asked for stillness -- so every other part of the component reads this
   * answer rather than working it out again and risking a different one.
   */
  const turning = isHeld && playing && !reduceMotion;

  // Format duration as m:ss only when known (non-zero)
  const formattedDuration =
    durationSec > 0
      ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}`
      : null;

  // SVG display size: 28px for "sm", 80px for "md". Viewbox stays fixed.
  const svgClass = isCompact ? "h-7 w-7" : "h-20 w-20";
  const gapClass = isCompact ? "gap-0" : "gap-3";

  return (
    <div className={`flex items-center ${gapClass}`}>
      {/* The vinyl disc SVG. Size 80px to sit comfortably in the 72–96px range. */}
      <motion.div
        // True only when the record is genuinely turning, which is the whole
        // claim this component makes and therefore the thing a test has to be
        // able to see. Marking every held disc instead would report "rotating"
        // for a paused song and leave the one rule here untestable.
        data-rotating={turning ? true : undefined}
        animate={turning ? { rotate: 360 } : { rotate: 0 }}
        transition={
          turning
            ? { duration: 1.8, repeat: Infinity, ease: "linear" }
            : { duration: 0 }
        }
        style={{ transformOrigin: "center" }}
        className="shrink-0"
      >
        <svg
          role="img"
          aria-label={
            isLoading
              ? "Track is loading"
              : isHeld && playing
                ? `Track is playing: ${title || "unknown song"}`
                : isHeld
                  ? `Track loaded: ${title || "unknown song"}`
                  : "Track"
          }
          viewBox="0 0 80 80"
          className={svgClass}
        >
          {isLoading ? (
            <>
              {/* Loading state: dim outline of disc body with no label */}
              <circle
                cx="40"
                cy="40"
                r="38"
                fill="none"
                stroke="var(--edge)"
                strokeWidth="1"
              />

              {/*
                A gold arc travelling the rim while the wait lasts. Its dash
                figures are the circumference of THIS circle -- 2 x pi x 38 is
                238.8 -- because a dash pattern that does not divide the path it
                runs on cannot return to where it started, and the arc visibly
                jumps back once a cycle instead of going round.

                Reduced motion is honoured here as well as on the disc. Someone
                who asked for stillness meant all of it, and the arc is the more
                distracting of the two: it never stops on its own.
              */}
              <defs>
                <style>{`
                  @keyframes track-disc-arc {
                    from { stroke-dashoffset: 0; }
                    to { stroke-dashoffset: -238.8; }
                  }
                  .track-disc-arc {
                    stroke-dasharray: 59.7 179.1;
                    animation: track-disc-arc 2s linear infinite;
                  }
                  @media (prefers-reduced-motion: reduce) {
                    .track-disc-arc { animation: none; }
                  }
                `}</style>
              </defs>
              <circle
                cx="40"
                cy="40"
                r="38"
                fill="none"
                stroke="var(--lamp)"
                strokeWidth="1.5"
                className="track-disc-arc"
              />
            </>
          ) : (
            <>
              {/* Held state: full vinyl disc */}

              {/* Disc body — deep letterbox blue */}
              <circle cx="40" cy="40" r="38" fill="var(--letterbox)" />

              {/* Grooves — 3 hairlines near the outer edge for detail */}
              <circle
                cx="40"
                cy="40"
                r="35"
                fill="none"
                stroke="var(--edge)"
                strokeWidth="0.5"
              />
              <circle
                cx="40"
                cy="40"
                r="30"
                fill="none"
                stroke="var(--edge)"
                strokeWidth="0.5"
              />
              <circle
                cx="40"
                cy="40"
                r="25"
                fill="none"
                stroke="var(--edge)"
                strokeWidth="0.5"
              />

              {/* Centre label — gold, or brightened to dress under reduced motion + playing */}
              <circle
                data-label
                cx="40"
                cy="40"
                r="12"
                fill={
                  reduceMotion && playing ? "var(--dress)" : "var(--lamp)"
                }
                style={{
                  transition: reduceMotion ? "fill 200ms ease-out" : "none",
                }}
              />

              {/* Tiny spindle detail in the centre */}
              <circle cx="40" cy="40" r="3" fill="var(--letterbox)" />
            </>
          )}
        </svg>
      </motion.div>

      {/* Title and duration, shown only in held state and not in compact size */}
      {isHeld && !isCompact && (
        <div className="min-w-0 flex-1">
          {title && (
            <p className="truncate text-sm font-medium text-[var(--cream)]">
              {title}
            </p>
          )}
          {formattedDuration && (
            <p className="text-xs tabular-nums text-[var(--mist)]">
              {formattedDuration}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
