"use client";

import { VideoTile } from "./VideoTile";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

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
      <VideoTile
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
