"use client";

import { AnimatePresence, motion } from "motion/react";
import type { MemeId } from "@/lib/rtc/protocol";

export interface ActiveMeme {
  key: number;
  id: MemeId;
}

const EMOJI: Record<MemeId, string> = {
  heart: "💖",
  peace: "✌️",
  thumbsUp: "👍",
  smile: "😄",
};

/**
 * The one place motion stays playful. Everything else on the page moves slowly;
 * a reaction should feel like a reaction.
 */
export function MemeOverlay({ memes }: { memes: ActiveMeme[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {memes.map((m) => (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, scale: 0.3, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.6, y: -60 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-7xl md:text-8xl"
            style={{ filter: "drop-shadow(0 6px 18px rgba(8,11,28,0.55))" }}
          >
            {EMOJI[m.id]}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
