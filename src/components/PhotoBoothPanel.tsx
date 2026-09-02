"use client";

import { useCallback } from "react";
import { ScenePainter } from "./ScenePainter";
import { paintScene } from "@/lib/photo/paint";
import { THEMES, theme as themeById, type Theme, type ThemeId } from "@/lib/photo/themes";
import { SHOT_COUNTS, type ShotCount } from "@/lib/photo/strip";

/**
 * The booth's controls, in the bottom letterbox bar.
 *
 * Two decisions and a button, because that is the whole of a photo booth: what
 * it should look like, how many pictures, and go. Both choices are shared, so
 * the pair of you are photographed against the same sky.
 */
export function PhotoBoothPanel({
  themeId,
  onTheme,
  shots,
  onShots,
  onStart,
  running,
  ready,
}: {
  themeId: ThemeId;
  onTheme: (id: ThemeId) => void;
  shots: ShotCount;
  onShots: (n: ShotCount) => void;
  onStart: () => void;
  running: boolean;
  /** False until both cameras are actually sending something to photograph. */
  ready: boolean;
}) {
  return (
    <section
      aria-label="Photo booth"
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-xs"
    >
      <span aria-hidden className="shrink-0 text-base">
        📸
      </span>

      <div
        role="radiogroup"
        aria-label="Look"
        className="flex shrink-0 items-center gap-1.5"
      >
        {THEMES.map((t) => (
          <Swatch
            key={t.id}
            theme={t}
            selected={t.id === themeId}
            onSelect={() => onTheme(t.id)}
          />
        ))}
      </div>

      <span className="shrink-0 text-[var(--mist)]">
        {themeById(themeId).note}
      </span>

      <div
        role="radiogroup"
        aria-label="How many photographs"
        className="flex shrink-0 items-center gap-1.5"
      >
        {SHOT_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === shots}
            onClick={() => onShots(n)}
            className={`rounded-[2px] border px-3 py-1 tracking-wide transition-colors ${
              n === shots
                ? "border-[var(--lamp)]/60 bg-[var(--lamp)]/10 text-[var(--lamp)]"
                : "border-[var(--edge)] text-[var(--mist)] hover:border-[var(--lamp)]/45 hover:text-[var(--cream)]"
            }`}
          >
            {n} shots
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={running || !ready}
        className="shrink-0 rounded-[2px] bg-[var(--dress)] px-5 py-1.5 font-medium tracking-wide text-[#1a1405] transition-colors hover:bg-[var(--lamp)] disabled:cursor-not-allowed disabled:bg-[var(--mist)]/25 disabled:text-[var(--mist)]"
      >
        {running ? "Hold still…" : "Take photos"}
      </button>

      <p className="w-full basis-full text-[0.65rem] text-[var(--mist)]">
        {ready
          ? "Both cameras fire on the same count, so you end up in the same picture. Nothing is sent — you each build the strip from the video you already have."
          : "Waiting for both cameras before the booth can take anything."}
      </p>
    </section>
  );
}

/**
 * A miniature of the real thing, painted by the same function that paints the
 * strip — so what you pick is literally what you get, at a smaller size.
 * Drawing these as hand-written CSS gradients would have been a third copy of
 * every theme, and the first one to fall out of date.
 */
function Swatch({
  theme,
  selected,
  onSelect,
}: {
  theme: Theme;
  selected: boolean;
  onSelect: () => void;
}) {
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, box: { width: number; height: number }) => {
      paintScene(ctx, theme, box);
    },
    [theme],
  );

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={theme.label}
      title={theme.label}
      onClick={onSelect}
      className={`relative h-7 w-7 overflow-hidden rounded-full border transition-transform hover:scale-110 ${
        selected
          ? "border-[var(--lamp)] ring-2 ring-[var(--lamp)]/35"
          : "border-[var(--edge)]"
      }`}
    >
      <ScenePainter paint={paint} className="absolute inset-0 h-full w-full" />
    </button>
  );
}
