"use client";

import type { MusicTrack } from "@/lib/rtc/protocol";

/**
 * Tonight's queue, dropped from the music bar's right edge.
 *
 * Each row plays its song when clicked. The playing row is lit in lamp, the
 * one colour the bar allows itself, so the eye finds it without reading.
 */
export function UpNext({
  id,
  queue,
  index,
  addedByName,
  onJump,
  onRemove,
}: {
  id: string;
  queue: MusicTrack[];
  index: number | null;
  /** "added by …" for a track, already resolved to you or them. */
  addedByName: (track: MusicTrack) => string;
  onJump: (at: number) => void;
  onRemove: (at: number) => void;
}) {
  return (
    <div
      id={id}
      className="absolute right-0 top-full z-20 w-full border border-t-0 border-[var(--edge)] bg-[var(--dusk)] shadow-[0_12px_28px_rgba(0,0,0,0.45)] @min-[40rem]:w-80"
    >
      {/* Scrolls on its own, downwards only, so a long evening's list never
          pushes the room around or runs off the side of a phone. */}
      <ol aria-label="Up next" className="max-h-72 overflow-y-auto py-1">
        {queue.map((track, at) => {
          const title = track.title ?? track.videoId;
          const current = at === index;
          return (
            <li
              // Position and id together: the same song may be queued twice.
              key={`${at}:${track.videoId}`}
              className="group flex items-center gap-2 px-3"
            >
              <button
                type="button"
                onClick={() => onJump(at)}
                aria-current={current ? "true" : undefined}
                className={`flex min-w-0 flex-1 flex-col items-start py-1.5 text-left transition-colors ${
                  current
                    ? "text-[var(--lamp)]"
                    : "text-[var(--mist)] hover:text-[var(--cream)]"
                }`}
              >
                <span className="w-full truncate">{title}</span>
                <span className="w-full truncate text-[0.65rem] opacity-70">
                  added by {addedByName(track)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(at)}
                aria-label={`Remove ${title}`}
                className="shrink-0 rounded-[2px] px-1.5 py-1 leading-none text-[var(--mist)] transition-colors hover:text-[var(--cream)]"
              >
                <span aria-hidden>✕</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
