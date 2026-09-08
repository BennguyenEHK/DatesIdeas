"use client";

import { VideoTile, type TileSwitches } from "./VideoTile";
import { FACES_FR, SCREEN_FR, takeoverAspect } from "@/lib/ui/stage";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

function isYou(label: string): boolean {
  return label === "You";
}

/**
 * A one-person performance needs a stage rather than a larger call tile. The
 * person playing gets the projector-sized frame; their one-person audience
 * stays visible alongside, so the performer can still play to a face.
 */
export function PerformerStage({
  performer,
  audience,
  performerLabel,
  audienceLabel,
  performerMemes,
  audienceMemes,
  mediaError,
  switches,
}: {
  performer: MediaStream | null;
  audience: MediaStream | null;
  performerLabel: string;
  audienceLabel: string;
  performerMemes: ActiveMeme[];
  audienceMemes: ActiveMeme[];
  mediaError: string | null;
  switches: TileSwitches;
}) {
  const performerIsYou = isYou(performerLabel);
  const audienceIsYou = isYou(audienceLabel);
  const performerSwitches = performerIsYou ? switches.you : switches.them;
  const audienceSwitches = audienceIsYou ? switches.you : switches.them;

  return (
    <div
      className="stage grid grid-cols-1 gap-3 md:grid-cols-[var(--stage-cols)] md:gap-4"
      style={
        {
          // The shared calculation keeps this layout and TakeoverStage the
          // same physical shape when their common proportions change.
          "--stage-aspect": takeoverAspect(),
          "--stage-cols": `${SCREEN_FR}fr ${FACES_FR}fr`,
        } as React.CSSProperties
      }
    >
      {/* The theatre framing belongs around the performer tile, not inside it:
          video and gesture reactions remain owned by VideoTile while the room
          provides the sense of a lamp falling onto a stage. */}
      <div
        className="relative aspect-video w-full overflow-hidden rounded-[2px] bg-[var(--letterbox)] ring-1 ring-[var(--edge)]"
        style={{
          boxShadow:
            "0 24px 70px -32px rgba(0,0,0,0.95), 0 0 90px -30px rgba(232,185,74,0.12)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              "radial-gradient(120% 70% at 50% -10%, rgba(232,185,74,0.16), transparent 55%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          style={{ boxShadow: "inset 0 0 90px 20px rgba(8,11,28,0.85)" }}
        />
        <div className="relative z-0 h-full w-full">
          <VideoTile
            size="full"
            stream={performer}
            mirrored={performerIsYou}
            muted={performerIsYou}
            label={performerLabel}
            memes={performerMemes}
            cameraOff={
              performerSwitches.camOff
                ? `${performerIsYou ? "Your" : "Their"} camera is off.`
                : null
            }
            micOff={performerSwitches.micOff}
            placeholder={
              performerIsYou
                ? mediaError === "denied"
                  ? "Your camera is blocked. Allow camera access in your browser to send video."
                  : mediaError === "unavailable"
                    ? "No camera found."
                    : "Starting your camera"
                : "Waiting for the performer to arrive."
            }
          />
        </div>
      </div>

      <div
        role="group"
        aria-label="Audience"
        className="grid grid-cols-1 gap-3 md:content-center md:gap-4"
      >
        <VideoTile
          size="compact"
          stream={audience}
          mirrored={audienceIsYou}
          muted={audienceIsYou}
          label={audienceLabel}
          memes={audienceMemes}
          cameraOff={
            audienceSwitches.camOff
              ? `${audienceIsYou ? "Your" : "Their"} camera is off.`
              : null
          }
          micOff={audienceSwitches.micOff}
          placeholder={
            audienceIsYou
              ? mediaError === "denied"
                ? "Your camera is blocked. Allow camera access in your browser to send video."
                : mediaError === "unavailable"
                  ? "No camera found."
                  : "Starting your camera"
              : "Waiting for them to arrive. Send them the code and this seat fills itself."
          }
        />
      </div>
    </div>
  );
}
