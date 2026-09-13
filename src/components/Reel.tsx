"use client";

import { useCallback, useEffect, useRef } from "react";
import { ReelStack } from "@/components/ReelStack";
import { frameIndexFor } from "@/lib/album/timeline";
import { GEARS, type Frame, type Gear, type ReelView } from "@/lib/album/types";

/**
 * The whole of your time together, as a strip of film in the bottom letterbox
 * bar.
 *
 * A carousel shows five things. This has to hold years, which is why it is an
 * edit bench rather than a carousel: the memory is projected in the picture
 * above, and this is the reel you scrub to get to another one. Two speeds --
 * swipe the picture to step one memory, drag this to travel.
 *
 * The component is deliberately dumb. Every grouping decision was made by
 * `buildReel` before anything got here, so this file contains no notion of a
 * day, a month or an occasion -- only frames, tape and signs, drawn in order.
 * That is what keeps the interesting logic in a pure module with tests.
 */

/** Frame height in the bar. Width follows; the strip is a fixed gauge. */
const FRAME_H = 54;
const FRAME_W = 76;

function gearLabel(gear: Gear): string {
  return gear === "frames" ? "frames" : gear;
}

export function Reel({
  view,
  currentItemId,
  gear,
  onSelect,
  onGear,
  threading = false,
}: {
  view: ReelView;
  currentItemId: string | null;
  gear: Gear;
  onSelect: (itemId: string) => void;
  onGear: (gear: Gear) => void;
  /** True only on the first paint, so the reel threads once and never again. */
  threading?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // The same lookup the gear change relies on, taken from the pure module
  // rather than repeated here. Two implementations of "which frame is this
  // memory in" is exactly how a reel ends up scrolling somewhere the
  // projector is not.
  const currentIndex = currentItemId === null ? -1 : frameIndexFor(view, currentItemId);

  // Keep the selected frame in view when it changes for a reason other than a
  // drag -- a keyboard step, a gear change, an occasion sign being clicked.
  // Scrolling on every render would fight the person's own thumb, so this is
  // keyed to the index rather than run unconditionally.
  useEffect(() => {
    if (currentIndex < 0) return;
    const track = trackRef.current;
    if (track === null) return;
    const frame = track.querySelector<HTMLElement>(`[data-index="${currentIndex}"]`);
    frame?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentIndex]);

  const step = useCallback(
    (delta: number) => {
      if (view.frames.length === 0) return;
      const from = currentIndex < 0 ? 0 : currentIndex;
      const next = Math.min(view.frames.length - 1, Math.max(0, from + delta));
      const frame = view.frames[next];
      if (frame !== undefined) onSelect(frame.item.id);
    },
    [currentIndex, onSelect, view.frames],
  );

  const changeGear = useCallback(
    (delta: number) => {
      const at = GEARS.indexOf(gear);
      const next = GEARS[Math.min(GEARS.length - 1, Math.max(0, at + delta))];
      if (next !== undefined && next !== gear) onGear(next);
    },
    [gear, onGear],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Shift travels ten frames at a time. The reel has two speeds under a
    // thumb and it should have two under a keyboard as well, or scrubbing a
    // year without a mouse means four hundred key presses.
    const far = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        step(far);
        break;
      case "ArrowLeft":
        event.preventDefault();
        step(-far);
        break;
      case "Home":
        event.preventDefault();
        step(-view.frames.length);
        break;
      case "End":
        event.preventDefault();
        step(view.frames.length);
        break;
      case "+":
      case "=":
        event.preventDefault();
        // Zooming OUT is moving along GEARS; "+" means see more, which is the
        // reading people expect from a map rather than from a microscope.
        changeGear(1);
        break;
      case "-":
      case "_":
        event.preventDefault();
        changeGear(-1);
        break;
      default:
        break;
    }
  }

  return (
    <div className="reel">
      <div
        ref={trackRef}
        role="listbox"
        aria-label="The reel"
        aria-orientation="horizontal"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={() => window.dispatchEvent(new Event("reel-stack-close"))}
        className={`reel-track px-4 ${threading ? "reel-thread" : ""}`}
      >
        {view.frames.map((frame, index) => (
          <ReelPiece
            key={frame.key}
            frame={frame}
            index={index}
            tape={view.tapes.find((t) => t.beforeIndex === index) ?? null}
            sign={view.marks.find((m) => m.frameIndex === index) ?? null}
            selected={index === currentIndex}
            onSelect={onSelect}
            stacked={gear !== "frames" && frame.count > 1}
          />
        ))}
      </div>

      <div className="flex items-center justify-between px-5 pt-2">
        <div role="group" aria-label="Zoom" className="flex items-center gap-3">
          {GEARS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onGear(option)}
              aria-pressed={option === gear}
              className={
                option === gear
                  ? "font-sans text-[11px] tracking-wide text-[var(--cream)] underline decoration-[var(--lamp)] underline-offset-4"
                  : "font-sans text-[11px] tracking-wide text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
              }
            >
              {gearLabel(option)}
            </button>
          ))}
        </div>
        <p className="font-sans text-[11px] tracking-wide text-[var(--mist)]">
          {view.frames.length === 0
            ? ""
            : (view.frames[Math.max(0, currentIndex)]?.date ?? "")}
        </p>
      </div>
    </div>
  );
}

function ReelPiece({
  frame,
  index,
  tape,
  sign,
  selected,
  onSelect,
  stacked,
}: {
  frame: Frame;
  index: number;
  tape: ReelView["tapes"][number] | null;
  sign: ReelView["marks"][number] | null;
  selected: boolean;
  onSelect: (itemId: string) => void;
  stacked: boolean;
}) {
  const still = frame.item.posterUrl ?? frame.item.url;

  return (
    <>
      {tape !== null ? (
        <div className="reel-tape" aria-hidden style={{ height: FRAME_H }}>
          {tape.label}
        </div>
      ) : null}

      <div className="relative flex flex-col justify-end">
        {sign !== null ? (
          <span
            title={sign.occasion.title}
            className={
              sign.lit
                ? "pointer-events-none absolute -top-0.5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[var(--lamp)] px-1.5 py-px font-sans text-[8px] tracking-wide text-[#1a1305]"
                : "pointer-events-none absolute -top-0.5 left-1/2 z-10 -translate-x-1/2 rounded-full px-1.5 py-px font-sans text-[8px] tracking-wide text-[var(--mist)] opacity-45 ring-1 ring-[var(--edge)]"
            }
          >
            {sign.occasion.title}
          </span>
        ) : null}

        {stacked ? (
          <ReelStack frame={frame} index={index} selected={selected} onSelect={onSelect} />
        ) : (
          <button
          type="button"
          role="option"
          aria-selected={selected}
          aria-current={selected}
          data-index={index}
          data-loved={frame.loved}
          className="reel-frame"
          style={{ width: FRAME_W, height: FRAME_H }}
          onClick={() => onSelect(frame.item.id)}
          // The date and what it is, not "frame 41 of 380". A screen reader
          // travelling this strip is doing the same thing an eye is: looking
          // for a day, not counting film.
          aria-label={
            frame.count > 1
              ? `${frame.date}, ${frame.count} memories`
              : `${frame.date}, ${frame.item.kind}`
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed,
              short-lived storage URL on an unknown host; the optimiser cannot
              fetch it and would only add a round trip that fails. */}
          <img
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
          {frame.count > 1 ? (
            <span
              aria-hidden
              className="absolute bottom-0.5 right-0.5 rounded bg-[#05070f]/80 px-1 font-sans text-[9px] text-[var(--cream)]"
            >
              {frame.count}
            </span>
          ) : null}
          </button>
        )}
      </div>
    </>
  );
}
