"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { MemeOverlay } from "./MemeOverlay";
import { ScenePainter } from "./ScenePainter";
import { paintScene, paintFinish } from "@/lib/photo/paint";
import { SCREEN_FR, FACES_FR, takeoverAspect } from "@/lib/ui/stage";
import type { Theme } from "@/lib/photo/themes";
import type { ActiveMeme } from "@/lib/ui/useMemeQueue";

/**
 * The booth itself: both of you standing in the same scene, waiting for it.
 *
 * The two feeds are feathered into the background rather than sitting in hard
 * rectangles, and one colour grade is laid over both. That grade is what makes
 * two people in two different rooms read as one photograph — without it this is
 * two webcam boxes on a nice wallpaper, and it looks like exactly that.
 *
 * The live view is not cut out; the flash is. Seeing yourselves lifted into the
 * scene only when the strip develops is the reveal, and it costs nothing during
 * the call because the segmenter runs on four still frames rather than thirty
 * a second.
 */
export function PhotoBoothStage({
  theme,
  local,
  remote,
  localMemes,
  remoteMemes,
  count,
  flashing,
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
  /** Handed up so the capture can read pixels out of these exact elements. */
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** The strip, developing in the column beside the booth. */
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

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

      {/* The count, and then the flash. Deliberately the only motion in here:
          everything else is still, so the moment reads as the moment. */}
      <AnimatePresence>
        {count !== null && (
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
        {flashing && (
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
 * One person, feathered into the scene.
 *
 * The mask is what does the blending: a soft oval, so there is no edge where
 * the person stops and the background starts. A hard rectangle here would
 * undo the grade's work entirely — you would read two boxes no matter how
 * carefully the light matched.
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

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    // The capture needs this exact element, so hand it upward as well.
    videoRef.current = ref.current;
  }, [stream, videoRef]);

  const feather =
    "radial-gradient(ellipse 68% 82% at 50% 46%, #000 58%, transparent 100%)";

  return (
    <div className="relative h-full flex-1">
      {stream ? (
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
