"use client";

import { activity, type ActivityId } from "@/lib/activities/registry";

/**
 * Stands in for an activity that has a bubble but no implementation yet.
 *
 * Deliberately says so out loud. The alternative — an empty frame — reads as a
 * bug, and someone would spend an evening wondering why the film never
 * started. This makes the shelf visibly ready and the thing on it visibly
 * absent.
 */
export function ActivityPlaceholder({ id }: { id: ActivityId | null }) {
  if (id === null) return null;
  const def = activity(id);

  return (
    <div className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="text-4xl opacity-70" aria-hidden>
        {def.icon}
      </span>
      <p className="font-[family-name:var(--font-display)] text-sm uppercase tracking-[0.4em] text-[var(--lamp)]">
        {def.label}
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-[var(--mist)]">
        Not built yet — the seat is reserved. Pick another activity, or close
        this one to go back to just the two of you.
      </p>
    </div>
  );
}
