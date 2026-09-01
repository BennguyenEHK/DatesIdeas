"use client";

import { useEffect, useRef } from "react";
import { MemeOverlay } from "./MemeOverlay";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

function Tile({
  stream,
  mirrored,
  muted,
  label,
  memes,
  placeholder,
}: {
  stream: MediaStream | null;
  mirrored: boolean;
  muted: boolean;
  label: string;
  memes: ActiveMeme[];
  placeholder: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

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
        <div className="flex h-full w-full items-center justify-center px-8 text-center">
          <p className="max-w-xs text-sm leading-relaxed text-[var(--mist)]">
            {placeholder}
          </p>
        </div>
      )}

      <MemeOverlay memes={memes} />

      {/* Set like a film slate rather than a chat-app name badge. */}
      <span
        className="absolute bottom-3 left-3 font-[family-name:var(--font-display)] text-[0.7rem] uppercase tracking-[0.42em] text-[var(--lamp)]"
        style={{ textShadow: "0 1px 6px rgba(8,11,28,0.9)" }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Each tile gets its own meme list, so a reaction lands on the face that made
 * it. Both people still see it — on your tile here, on their "Them" tile
 * there — but it is never duplicated across both.
 */
export function VideoStage({
  local,
  remote,
  localMemes,
  remoteMemes,
  mediaError,
}: {
  local: MediaStream | null;
  remote: MediaStream | null;
  localMemes: ActiveMeme[];
  remoteMemes: ActiveMeme[];
  mediaError: string | null;
}) {
  return (
    <div className="grid w-full gap-3 md:grid-cols-2 md:gap-4">
      <Tile
        stream={local}
        mirrored
        muted
        label="You"
        memes={localMemes}
        placeholder={
          mediaError === "denied"
            ? "Your camera is blocked. You can still see and hear them — allow camera access in your browser to send video."
            : mediaError === "unavailable"
              ? "No camera found. You can still see and hear them."
              : "Starting your camera"
        }
      />
      <Tile
        stream={remote}
        mirrored={false}
        muted={false}
        label="Them"
        memes={remoteMemes}
        placeholder="Waiting for them to arrive. Send them the code and this seat fills itself."
      />
    </div>
  );
}
