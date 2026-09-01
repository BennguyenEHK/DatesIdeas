"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Card } from "@/lib/cards/types";
import { MOOD_LABELS } from "@/lib/cards/types";

/**
 * The question band beneath the two video tiles. It never overlays the
 * faces — this is the letterbox, not the screen — so it is a full-width
 * strip that pushes the layout rather than floating over it.
 *
 * Visually it borrows the site's one recurring idea (a lamp glow against
 * the night sky) and applies it at a smaller scale: a lit marquee sign,
 * the row of bulbs along its top edge standing in for the strip lights
 * that ring a theatre board.
 */
export function QuestionCard({
  card,
  onDismiss,
}: {
  card: Card | null;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      {card ? (
        <motion.section
          key={card.id}
          role="region"
          aria-label="Question card"
          initial={{ opacity: 0, y: reduceMotion ? 0 : 22, scale: reduceMotion ? 1 : 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{
            opacity: 0,
            y: reduceMotion ? 0 : -14,
            scale: reduceMotion ? 1 : 0.98,
            transition: { duration: reduceMotion ? 0.15 : 0.3, ease: "easeOut" },
          }}
          transition={{ duration: reduceMotion ? 0.2 : 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative isolate mt-3 w-full overflow-hidden rounded-[2px] ring-1 ring-[var(--edge)] md:mt-4"
          style={{
            // A warm wash falling from the top edge, the way marquee light
            // spills down a sign, over the same night-to-dusk ground the
            // video tiles sit on.
            background:
              "radial-gradient(140% 160% at 50% -35%, rgba(242,194,48,0.24), transparent 62%), linear-gradient(180deg, var(--dusk), var(--night))",
            boxShadow:
              "0 -22px 64px -28px rgba(232,185,74,0.4), 0 20px 54px -32px rgba(0,0,0,0.75)",
          }}
        >
          {/* The bulb strip. Evenly spaced dots via a repeating background
              rather than mapped DOM nodes, so it stays crisp at any width
              with no per-breakpoint count to maintain. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[6px]"
            style={{
              backgroundImage: "radial-gradient(circle, var(--lamp) 0 1.5px, transparent 2px)",
              backgroundSize: "18px 100%",
              backgroundPosition: "center",
              filter: "drop-shadow(0 0 4px rgba(232,185,74,0.85))",
            }}
            animate={
              reduceMotion ? { opacity: 0.9 } : { opacity: [0.55, 1, 0.55] }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 3.6, repeat: Infinity, ease: "easeInOut" }
            }
          />

          <div className="flex flex-col gap-3 px-5 py-6 sm:px-8 sm:py-8 md:px-10">
            <div className="flex items-start justify-between gap-4">
              <p
                className="font-[family-name:var(--font-display)] text-[0.68rem] uppercase tracking-[0.4em] text-[var(--lamp)]"
                style={{ textShadow: "0 1px 6px rgba(8,11,28,0.7)" }}
              >
                {MOOD_LABELS[card.mood]}
              </p>

              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss question"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--mist)] ring-1 ring-[var(--edge)] transition-colors hover:text-[var(--cream)] hover:ring-[var(--lamp)]/70 focus-visible:text-[var(--cream)]"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5 fill-none stroke-current"
                  strokeWidth={1.6}
                >
                  <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* role="status" so the swap is announced even though this
                paragraph is inside a section that just remounted, not one
                whose text changed in place. */}
            <p
              role="status"
              className="max-w-3xl text-balance break-words font-sans text-[clamp(1.3rem,1rem+2.2vw,2.1rem)] font-medium leading-[1.45] text-[var(--cream)]"
            >
              {card.text}
            </p>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
