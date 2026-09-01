"use client";

import { VideoTile } from "./VideoTile";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

/**
 * The counterpart to VideoStage for when an activity takes over the frame:
 * a film-sized screen on the left, the two faces still visible in a column
 * beside it. `fr` tracks rather than percentages — a percentage pair plus a
 * gap overflows its grid cell by exactly one gap, and grid is the one layout
 * that folds the gap into the track math for free.
 *
 * Tiles get their own column instead of floating over the content because
 * gesture memes render inside them (see VideoTile) — a heart landing on top
 * of the film, instead of on the face that sent it, would misread entirely.
 */
export function TakeoverStage({
  local,
  remote,
  localMemes,
  remoteMemes,
  mediaError,
  children,
}: {
  local: MediaStream | null;
  remote: MediaStream | null;
  localMemes: ActiveMeme[];
  remoteMemes: ActiveMeme[];
  mediaError: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-[3fr_1fr] md:gap-4">
      {/* The screen. A dark frame even before a film loads it, so an empty
          child never reads as an unstyled box — just as a theatre reads as
          a theatre before the projector lamp comes on. */}
      <div
        className="relative aspect-video w-full overflow-hidden rounded-[2px] bg-[var(--letterbox)] ring-1 ring-[var(--edge)]"
        style={{
          boxShadow:
            "0 24px 70px -32px rgba(0,0,0,0.95), 0 0 90px -30px rgba(232,185,74,0.12)",
        }}
      >
        {/* Lamp spill from above, the way projector light haunts the top of
            a screen, fading fast so it never competes with what's showing. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              "radial-gradient(120% 70% at 50% -10%, rgba(232,185,74,0.16), transparent 55%)",
          }}
        />
        {/* Inner vignette, so even a plain placeholder sits inside a room
            rather than on a flat fill. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            boxShadow: "inset 0 0 90px 20px rgba(8,11,28,0.85)",
          }}
        />
        <div className="relative z-0 flex h-full w-full items-center justify-center">
          {children}
        </div>
      </div>

      {/* The two faces. A row on a phone (side by side does not fit next to
          a full-width screen), a column once there is room beside it. */}
      <div
        role="group"
        aria-label="Video call participants"
        className="grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-4"
      >
        <VideoTile
          size="compact"
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
        <VideoTile
          size="compact"
          stream={remote}
          mirrored={false}
          muted={false}
          label="Them"
          memes={remoteMemes}
          placeholder="Waiting for them to arrive. Send them the code and this seat fills itself."
        />
      </div>
    </div>
  );
}
