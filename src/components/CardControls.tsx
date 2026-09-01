"use client";

import { MOODS, MOOD_LABELS } from "@/lib/cards/types";
import type { MoodFilter } from "@/lib/cards/draw";

const FILTERS: { value: MoodFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...MOODS.map((m) => ({ value: m as MoodFilter, label: MOOD_LABELS[m] })),
];

/**
 * Draw button and mood filter, sat in the bottom letterbox bar.
 *
 * The filter is local and never sent: choosing "Deep" changes what YOU draw,
 * so the evening can move deeper without either of you having to announce it.
 */
export function CardControls({
  mood,
  onMood,
  onDraw,
  disabled,
  hasCard,
}: {
  mood: MoodFilter;
  onMood: (m: MoodFilter) => void;
  onDraw: () => void;
  disabled: boolean;
  hasCard: boolean;
}) {
  if (disabled) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex items-center gap-1" role="group" aria-label="Question mood">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onMood(f.value)}
            aria-pressed={mood === f.value}
            className={`rounded-[2px] px-2 py-1 tracking-wide transition-colors ${
              mood === f.value
                ? "bg-[var(--lamp)]/15 text-[var(--lamp)]"
                : "text-[var(--mist)] hover:text-[var(--cream)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <button
        onClick={onDraw}
        className="rounded-[2px] border border-[var(--lamp)]/45 px-4 py-1.5 tracking-wide text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10"
      >
        {hasCard ? "Next question" : "Draw a question"}
      </button>
    </div>
  );
}
