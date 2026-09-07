"use client";

import { useEffect, useRef } from "react";
import { MemeOverlay } from "./MemeOverlay";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

export type TileSize = "full" | "compact";

/**
 * Which of the four devices in the room are switched off.
 *
 * Carried as one object rather than four props because the two stages pass it
 * straight through and neither of them has any business taking it apart.
 */
export interface TileSwitches {
  you: { micOff: boolean; camOff: boolean };
  /** The other person's, as they last said. Both false until they say. */
  them: { micOff: boolean; camOff: boolean };
}

/**
 * One person's video, with their reactions landing on it.
 *
 * Shared by both stage layouts rather than duplicated, so a meme behaves the
 * same whether the tile is full size or shrunk beside a film. `size` scales
 * the overlay and the slate label with it: a 72px emoji that reads well on a
 * half-width tile would swallow a quarter-width one whole.
 */
export function VideoTile({
  stream,
  mirrored,
  muted,
  label,
  memes,
  placeholder,
  cameraOff = null,
  micOff = false,
  size = "full",
}: {
  stream: MediaStream | null;
  mirrored: boolean;
  muted: boolean;
  label: string;
  memes: ActiveMeme[];
  placeholder: string;
  /**
   * What to say over the picture when the camera is switched off, or null when
   * it is not.
   *
   * A disabled track keeps sending -- black frames rather than nothing -- so
   * without this the tile shows an unexplained black rectangle that looks
   * exactly like a connection that has died.
   */
  cameraOff?: string | null;
  /** Whether that side's microphone is switched off. */
  micOff?: boolean;
  size?: TileSize;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  const compact = size === "compact";

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-[2px] bg-[#0a0d1e] ring-1 ring-[var(--edge)]"
      style={{ boxShadow: "0 18px 60px -30px rgba(0,0,0,0.9)" }}
    >
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className="h-full w-full object-cover"
          // Mirror only your own view. Mirroring theirs would make a peace sign
          // read backwards and a heart land on the wrong side.
          style={mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center text-center ${
            compact ? "px-3" : "px-8"
          }`}
        >
          <p
            className={`max-w-xs leading-relaxed text-[var(--mist)] ${
              compact ? "text-[0.7rem]" : "text-sm"
            }`}
          >
            {placeholder}
          </p>
        </div>
      )}

      {/* Laid over the video rather than replacing it. The remote tile is the
          element actually playing their voice, so unmounting it to show a
          message would switch their camera off and take their sound with it. */}
      {stream && cameraOff !== null && (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-[#0a0d1e] text-center ${
            compact ? "px-3" : "px-8"
          }`}
        >
          <p
            className={`max-w-xs leading-relaxed text-[var(--mist)] ${
              compact ? "text-[0.7rem]" : "text-sm"
            }`}
          >
            {cameraOff}
          </p>
        </div>
      )}

      <MemeOverlay memes={memes} size={size} />

      {/* Beside the slate, because that is where the name of whoever is silent
          already is. Silence is otherwise indistinguishable from somebody
          simply not talking, which is most of any evening. */}
      {micOff && (
        <span
          title={`${label} muted`}
          className={`absolute inline-flex items-center justify-center rounded-full bg-[var(--letterbox)]/80 text-[var(--neon)] ring-1 ring-[var(--neon)]/50 ${
            compact ? "bottom-1.5 right-2 h-4 w-4" : "bottom-3 right-3 h-6 w-6"
          }`}
        >
          <span className="sr-only">{label} muted</span>
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className={`fill-none stroke-current ${compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"}`}
            strokeWidth={1.6}
          >
            <rect x="6" y="1.6" width="4" height="7.5" rx="2" />
            <path d="M3.6 7.2a4.4 4.4 0 0 0 8.8 0M8 11.6v2.6" strokeLinecap="round" />
            <path d="M2.5 13.5 13.5 2.5" strokeLinecap="round" />
          </svg>
        </span>
      )}

      {/* Set like a film slate rather than a chat-app name badge. */}
      <span
        className={`absolute font-[family-name:var(--font-display)] uppercase text-[var(--lamp)] ${
          compact
            ? "bottom-1.5 left-2 text-[0.55rem] tracking-[0.3em]"
            : "bottom-3 left-3 text-[0.7rem] tracking-[0.42em]"
        }`}
        style={{ textShadow: "0 1px 6px rgba(8,11,28,0.9)" }}
      >
        {label}
      </span>
    </div>
  );
}
