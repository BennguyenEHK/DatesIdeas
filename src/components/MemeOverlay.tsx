"use client";

import { AnimatePresence, motion } from "motion/react";
import type { MemeId } from "@/lib/rtc/protocol";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

export type { ActiveMeme };

const EMOJI: Record<MemeId, string> = {
  heart: "💖",
  peace: "✌️",
  thumbsUp: "👍",
  smile: "😄",
  blowKiss: "😘",
  handsOverMouth: "🫢",
  wink: "😉",
  pray: "🙏",
  thumbsDown: "👎",
};

/**
 * The one place motion stays playful. Everything else on the page moves slowly;
 * a reaction should feel like a reaction.
 *
 * Three beats: a spring pop-in, a still hold (the queue's timer owns that), and
 * a soft fade upward. The fade is a plain tween — springing on the way out
 * would fight the drift and read as a bounce rather than a goodbye.
 */
export function MemeOverlay({
  memes,
  size = "full",
}: {
  memes: ActiveMeme[];
  /** Scales the emoji to its tile. A full-size reaction swamps a small one. */
  size?: "full" | "compact";
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {memes.map((m) => (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, scale: 0.3, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: 1.15,
              y: -60,
              transition: { duration: 0.35, ease: "easeOut" },
            }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none ${
              size === "compact" ? "text-3xl md:text-4xl" : "text-7xl md:text-8xl"
            }`}
            style={{ filter: "drop-shadow(0 6px 18px rgba(8,11,28,0.55))" }}
          >
            {EMOJI[m.id]}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
