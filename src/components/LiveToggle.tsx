"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The two ways a room can use its music. This is a mode switch rather than a
 * menu: the lamp moves from one fixed stop to the other like a theatre-wall
 * switch, while both choices remain present and easy to reverse.
 */
export function LiveToggle({
  live,
  enabled,
  onChange,
}: {
  live: boolean;
  /** False while there is nobody to perform to. */
  enabled: boolean;
  onChange: (live: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const unavailableReason = "Live mode needs someone to perform to.";

  return (
    <div
      role="radiogroup"
      aria-label="Performance mode"
      className={`relative inline-grid w-full max-w-52 grid-cols-2 overflow-hidden rounded-[2px] bg-[var(--night)] p-px ring-1 ring-[var(--edge)] sm:w-auto ${
        enabled ? "" : "opacity-35 grayscale"
      }`}
    >
      {/* The lamp sits behind both stops, so changing modes moves one physical
          part instead of making two unrelated buttons blink in and out. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-px left-px z-0 w-[calc(50%-1px)] rounded-[2px] bg-[var(--lamp)]/20 ring-1 ring-[var(--lamp)]/80"
        animate={{ x: live ? "100%" : "0%" }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
      >
        <span
          className="absolute inset-[-6px] -z-10 bg-[radial-gradient(circle,rgba(242,194,48,0.7),transparent_70%)] opacity-75 blur-[5px]"
        />
      </motion.span>

      <button
        type="button"
        role="radio"
        aria-checked={!live}
        disabled={!enabled}
        title={enabled ? "Karaoke mode" : unavailableReason}
        onClick={() => onChange(false)}
        className={`relative z-10 min-w-0 px-3 py-1.5 text-xs transition-colors duration-300 ${
          !live
            ? "text-[var(--cream)]"
            : "text-[var(--mist)] hover:bg-[var(--lamp)]/10 hover:text-[var(--cream)]"
        } ${enabled ? "" : "cursor-not-allowed"}`}
      >
        Karaoke
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={live}
        disabled={!enabled}
        title={enabled ? "Live mode" : unavailableReason}
        onClick={() => onChange(true)}
        className={`relative z-10 min-w-0 border-l border-[var(--edge)] px-3 py-1.5 text-xs transition-colors duration-300 ${
          live
            ? "text-[var(--cream)]"
            : "text-[var(--mist)] hover:bg-[var(--lamp)]/10 hover:text-[var(--cream)]"
        } ${enabled ? "" : "cursor-not-allowed"}`}
      >
        Live
      </button>
    </div>
  );
}
