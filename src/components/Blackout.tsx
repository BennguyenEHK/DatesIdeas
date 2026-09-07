"use client";

import { motion, useReducedMotion } from "motion/react";
import { TV_OFF_MS, type EndingPhase } from "@/lib/room/ending";

/**
 * The set being switched off at the end of the evening.
 *
 * An overlay rather than a wrapper around the room, for two reasons that both
 * matter. The room's layout is a flex column filling the viewport, and putting
 * a transformed box around it changes that layout the instant the phase flips.
 * And the countdown that drives this lives inside the room -- so unmounting the
 * room to show black would take the timer with it, and the last step, the one
 * that actually leaves, would never run.
 *
 * The picture cuts to black while a bright line snaps across the middle, the
 * line draws in to a point, and the point dies. That is a cathode tube losing
 * its deflection and then its beam, in that order, which is the sequence
 * everyone recognises even if nobody has owned the television in twenty years.
 */
export function Blackout({ phase }: { phase: EndingPhase }) {
  const reduceMotion = useReducedMotion();

  if (phase !== "closing" && phase !== "dark") return null;

  // Already over: hold plain black while the homepage is fetched behind it.
  // No animation here even normally -- this is the gap, not a step.
  if (phase === "dark") {
    return <div aria-hidden className="fixed inset-0 z-50 bg-black" />;
  }

  const seconds = TV_OFF_MS / 1000;

  return (
    <div aria-hidden className="fixed inset-0 z-50 overflow-hidden">
      {/* The picture going. Fast, and first: a tube loses the image before it
          loses the beam, and fading these together reads as a dissolve. */}
      <motion.div
        className="absolute inset-0 bg-black"
        initial={{ opacity: reduceMotion ? 1 : 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : seconds * 0.4, ease: "easeIn" }}
      />

      {/* The beam. Nothing to see for somebody who asked for no motion -- the
          whole of this element IS motion, and a bright bar parked across a
          black screen would be worse than no effect at all. */}
      {!reduceMotion && (
        <motion.div
          className="absolute left-0 top-1/2 h-[3px] w-full -translate-y-1/2 bg-[var(--cream)]"
          style={{ boxShadow: "0 0 24px 6px rgba(245,239,224,0.85)" }}
          initial={{ scaleX: 1, scaleY: 0.2, opacity: 0 }}
          // Every track is the same length as `times`; framer-motion pairs them
          // by index, and a short one silently stops matching the schedule.
          animate={{
            scaleX: [1, 1, 0.002, 0.002],
            scaleY: [0.2, 1, 1, 1],
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: seconds,
            times: [0, 0.45, 0.85, 1],
            ease: "easeInOut",
          }}
        />
      )}
    </div>
  );
}
