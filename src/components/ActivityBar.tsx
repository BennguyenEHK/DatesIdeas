"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ACTIVITIES, type ActivityId } from "@/lib/activities/registry";

// Shown on the collapsed trigger when nothing is selected yet — the moment
// before either of you has picked anything, still in keeping with the
// marquee-light vocabulary rather than a blank/neutral glyph.
const NEUTRAL_ICON = "✨";
const NEUTRAL_LABEL = "Activities";

// Collapsing is the reader's choice at every width, never forced by one.
// A CSS breakpoint that hides the row below some size does not degrade the
// menu, it removes it: the toggle still flips its own state, so the button
// appears to work while the activities stay permanently unreachable. Four
// 32px bubbles are ~146px, which fits a 360px phone beside the monogram and
// the room code; the header wraps if it ever does not.

function bubbleClass(selected: boolean, ready: boolean): string {
  const base =
    "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base ring-1 transition-colors duration-300";
  if (!ready) {
    // Dimmed and desaturated rather than hidden — the point is "not built
    // yet", not "doesn't exist". No hover treatment: it isn't interactive.
    return `${base} cursor-not-allowed bg-transparent text-[var(--mist)] opacity-35 grayscale ring-[var(--edge)]`;
  }
  if (selected) {
    return `${base} bg-[var(--lamp)]/20 text-[var(--cream)] ring-[var(--lamp)]/80`;
  }
  return `${base} bg-transparent text-[var(--mist)] ring-[var(--edge)] hover:bg-[var(--lamp)]/10 hover:text-[var(--cream)] hover:ring-[var(--lamp)]/50`;
}

/**
 * The activity menu, living in the top letterbox bar. Each bubble is a
 * marquee bulb — the same lit-dot language as the strip along the top of
 * QuestionCard, relocated here and made clickable. A selected activity is a
 * bulb that's lit; an activity that isn't built yet is a bulb with no power
 * to it at all.
 */
export function ActivityBar({
  current,
  onSelect,
}: {
  current: ActivityId | null;
  onSelect: (id: ActivityId | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const reduceMotion = useReducedMotion();
  const groupId = useId();

  const currentDef = current ? ACTIVITIES.find((a) => a.id === current) ?? null : null;
  const triggerIcon = currentDef?.icon ?? NEUTRAL_ICON;
  const triggerLabel = currentDef?.label ?? NEUTRAL_LABEL;

  return (
    <div className="flex items-center gap-1.5">
      <div
        id={groupId}
        role="group"
        aria-label="Activities"
        className={expanded ? "flex items-center gap-1.5" : "hidden"}
      >
        {ACTIVITIES.map((activityDef) => {
          const selected = activityDef.id === current;
          return (
            <button
              key={activityDef.id}
              type="button"
              aria-pressed={selected}
              aria-label={selected ? `Close ${activityDef.label}` : activityDef.label}
              title={
                activityDef.ready
                  ? selected
                    ? `Close ${activityDef.label}`
                    : activityDef.label
                  : `${activityDef.label} — not built yet`
              }
              disabled={!activityDef.ready}
              onClick={() => onSelect(selected ? null : activityDef.id)}
              className={bubbleClass(selected, activityDef.ready)}
            >
              {selected ? (
                // The glow: a soft radial bloom pulsing behind the bulb,
                // same technique as the QuestionCard bulb strip. Reduced
                // motion collapses it to a single steady value — still lit,
                // just not breathing.
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute inset-[-6px] rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(242,194,48,0.85), transparent 70%)",
                    filter: "blur(5px)",
                  }}
                  animate={reduceMotion ? { opacity: 0.85 } : { opacity: [0.55, 1, 0.55] }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                  }
                />
              ) : null}
              <span aria-hidden className="relative z-10">
                {activityDef.icon}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={groupId}
        aria-label={expanded ? "Collapse activity menu" : `Expand activity menu, ${triggerLabel} active`}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-1 text-[var(--mist)] ring-1 ring-transparent transition-colors hover:text-[var(--cream)] hover:ring-[var(--edge)]"
      >
        {/* Icon + label: the collapsed trigger's content. Shown whenever the
            row itself isn't — either because `expanded` is false, or because
            the viewport is too narrow for the row regardless of state. */}
        <span
          className={
            expanded
              ? "hidden"
              : "inline-flex items-center gap-1.5 px-2"
          }
        >
          <span aria-hidden className="text-base">
            {triggerIcon}
          </span>
          <span className="hidden font-sans text-xs tracking-wide sm:inline">
            {triggerLabel}
          </span>
        </span>

        {/* The retract chevron: only meaningful once the row is actually on
            screen, i.e. expanded on a wide-enough viewport. */}
        <span aria-hidden className={expanded ? "inline-flex px-2" : "hidden"}>
          <svg viewBox="0 0 16 16" className="h-3 w-3 rotate-180 fill-none stroke-current" strokeWidth={1.6}>
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    </div>
  );
}
