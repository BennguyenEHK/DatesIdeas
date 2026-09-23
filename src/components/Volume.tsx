"use client";

import { useId } from "react";

/**
 * This side's own loudness for a shared player.
 *
 * Used by the film and by the music bar. The level never crosses the
 * connection: each side streams its own copy, so turning it down here leaves
 * the other person's exactly where it was.
 */
export function Volume({
  value,
  onChange,
}: {
  value: number;
  onChange: (percent: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <label htmlFor={id} className="whitespace-nowrap text-[var(--mist)]">
        Volume
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={value === 0 ? "Muted here" : `${value} percent`}
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-[var(--edge)] accent-[var(--lamp)]"
      />
      <span className="w-8 tabular-nums text-[var(--mist)]">
        {value === 0 ? "off" : `${value}%`}
      </span>
    </div>
  );
}
