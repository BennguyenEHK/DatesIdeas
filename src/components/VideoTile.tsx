"use client";

import { useEffect, useRef } from "react";
import { MemeOverlay } from "./MemeOverlay";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

export type TileSize = "full" | "compact";

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
  size = "full",
}: {
  stream: MediaStream | null;
  mirrored: boolean;
  muted: boolean;
  label: string;
  memes: ActiveMeme[];
  placeholder: string;
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

      <MemeOverlay memes={memes} size={size} />

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
