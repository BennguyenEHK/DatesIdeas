"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { MemeOverlay } from "./MemeOverlay";
import { ScenePainter } from "./ScenePainter";
import {
  paintScene,
  paintFinish,
  PERSON_BLUR_ALPHA,
  PERSON_BLUR_PX,
} from "@/lib/photo/paint";
import { SCREEN_FR, FACES_FR, takeoverAspect } from "@/lib/ui/stage";
import type { Theme } from "@/lib/photo/themes";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

/**
 * The booth itself: both of you standing in the same scene, waiting for it.
 *
 * Each feed stays sharp over its own softly blurred portrait backdrop, so two
 * rooms can fall away while the people remain the subject. One colour grade is
 * laid over both, which makes two people in different rooms read as one
 * photograph; without it this is two webcam boxes on a nice wallpaper.
 *
 * The live view keeps the camera portrait intact rather than cutting either of
 * you out. After a flash, the photograph takes over briefly so the moment can
 * be checked before the strip moves on.
 */
export function PhotoBoothStage({
  theme,
  local,
  remote,
  localMemes,
  remoteMemes,
  count,
  flashing,
  review,
  shots,
  localVideoRef,
  remoteVideoRef,
  children,
}: {
  theme: Theme;
  local: MediaStream | null;
  remote: MediaStream | null;
  localMemes: ActiveMeme[];
  remoteMemes: ActiveMeme[];
  /** The number on screen, or null between counts. */
  count: number | null;
  flashing: boolean;
  review: { shotIndex: number; frame: { canvas: HTMLCanvasElement } | null } | null;
  shots: number;
  /** Handed up so the capture can read pixels out of these exact elements. */
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** The strip, developing in the column beside the booth. */
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const reviewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const destination = reviewCanvasRef.current;
    const source = review?.frame?.canvas;
    if (!destination || !source) return;

    destination.width = source.width;
    destination.height = source.height;
    const context = destination.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, destination.width, destination.height);
    context.drawImage(source, 0, 0);
  }, [review]);

  const scene = useCallback(
    (ctx: CanvasRenderingContext2D, box: { width: number; height: number }) => {
      paintScene(ctx, theme, box);
    },
    [theme],
  );

  const finish = useCallback(
    (ctx: CanvasRenderingContext2D, box: { width: number; height: number }) => {
      // The grade covers the whole stage here because the whole stage is the
      // photograph — there is no caption band to keep clear of, as there is on
      // the strip.
      paintFinish(ctx, theme, box, [
        { x: 0, y: 0, width: box.width, height: box.height },
      ]);
    },
    [theme],
  );

  return (
    <div
      className="stage grid grid-cols-1 gap-3 md:grid-cols-[var(--stage-cols)] md:gap-4"
      style={
        {
          "--stage-aspect": takeoverAspect(),
          "--stage-cols": `${SCREEN_FR}fr ${FACES_FR}fr`,
        } as React.CSSProperties
      }
    >
      {/* The booth. One 16:9 frame with both of you in it, which is the shape
          each photograph on the strip has — so the preview is a true preview
          rather than a differently-cropped rehearsal. */}
      <div className="relative aspect-video overflow-hidden rounded-[2px] ring-1 ring-[var(--edge)]">
      <ScenePainter paint={scene} className="absolute inset-0 h-full w-full" />

      <div className="absolute inset-0 flex">
        <Half
          videoRef={localVideoRef}
          stream={local}
          mirrored
          muted
          label="You"
          memes={localMemes}
        />
        <Half
          videoRef={remoteVideoRef}
          stream={remote}
          mirrored={false}
          muted={false}
          label="Them"
          memes={remoteMemes}
        />
      </div>

      <ScenePainter
        paint={finish}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      <AnimatePresence>
        {review !== null && review.frame !== null && (
          <motion.div
            key={`${review.shotIndex}-${review.frame.canvas.width}-${review.frame.canvas.height}`}
            className="absolute inset-0"
            initial={{ opacity: reduceMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
          >
            <canvas
              ref={reviewCanvasRef}
              aria-hidden
              className="h-full w-full object-cover"
            />
            <span
              className="pointer-events-none absolute inset-x-0 bottom-4 text-center font-[family-name:var(--font-display)] text-[0.7rem] tracking-[0.18em] text-[var(--cream)]"
              style={{ textShadow: "0 1px 6px rgba(8,11,28,0.9)" }}
            >
              Shot {review.shotIndex + 1} of {shots}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The count, and then the flash. Deliberately the only motion in here:
          everything else is still, so the moment reads as the moment. */}
      <AnimatePresence>
        {review === null && count !== null && (
          <motion.div
            key={count}
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 1.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
            transition={{ duration: reduceMotion ? 0 : 0.35, ease: "easeOut" }}
          >
            <span
              className="font-[family-name:var(--font-display)] text-[clamp(4rem,18vw,11rem)] leading-none text-[var(--cream)]"
              style={{ textShadow: "0 0 0.3em rgba(8,11,28,0.8)" }}
            >
              {count}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {review === null && flashing && (
          <motion.div
            key="flash"
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-white"
            initial={{ opacity: reduceMotion ? 0.25 : 0.9 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.1 : 0.45, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      </div>

      <div className="min-h-0 md:content-center">{children}</div>
    </div>
  );
}

/**
 * One person, sharp over a portrait-mode room.
 *
 * The blurred copy gives the room somewhere to fall away without darkening the
 * face. The sharp copy keeps the feather so the scene still has no hard seam,
 * and the separate backdrop avoids turning the grade into a dark curtain.
 * It is the only element handed to capture; reversing those roles silently
 * saves a blurred photograph.
 */
function Half({
  videoRef,
  stream,
  mirrored,
  muted,
  label,
  memes,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  mirrored: boolean;
  muted: boolean;
  label: string;
  memes: ActiveMeme[];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    if (backdropRef.current) backdropRef.current.srcObject = stream;
    // The capture needs this exact element, so hand it upward as well.
    videoRef.current = ref.current;
  }, [stream, videoRef]);

  const feather =
    "radial-gradient(ellipse 68% 82% at 50% 46%, #000 58%, transparent 100%)";

  return (
    <div className="relative h-full flex-1">
      {stream ? (
        <>
          <video
            ref={backdropRef}
            autoPlay
            playsInline
            muted
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              filter: `blur(${PERSON_BLUR_PX}px)`,
              opacity: PERSON_BLUR_ALPHA,
              transform: mirrored ? "scaleX(-1)" : undefined,
            }}
          />
          <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className="h-full w-full object-cover"
          style={{
            transform: mirrored ? "scaleX(-1)" : undefined,
            maskImage: feather,
            WebkitMaskImage: feather,
          }}
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center px-6 text-center">
          <p className="text-xs leading-relaxed text-[var(--cream)]/70">
            Waiting for them to arrive.
          </p>
        </div>
      )}

      <MemeOverlay memes={memes} size="full" />

      <span
        className="absolute bottom-3 left-3 font-[family-name:var(--font-display)] text-[0.7rem] uppercase tracking-[0.42em] text-[var(--cream)]"
        style={{ textShadow: "0 1px 6px rgba(8,11,28,0.9)" }}
      >
        {label}
      </span>
    </div>
  );
}
