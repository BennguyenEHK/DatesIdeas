"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startRecording, type Clip, type Recording } from "./record";
import { paintShot } from "./paint";
import { PANEL_ASPECT } from "./strip";
import type { Theme } from "./themes";

/**
 * How large the live photo is filmed.
 *
 * Smaller than the still on purpose. Every frame repaints the scene and
 * feathers both of you into it, twenty-four times a second, beside a live
 * video call — and the cost of that scales with area. At 640 wide a live photo
 * still reads beautifully on a phone, which is the only place it will ever be
 * watched.
 */
export const LIVE_WIDTH = 640;

/** How large the mirrored scratch copy of the local camera is kept. */
const SCRATCH_WIDTH = 640;

export interface LiveFilm {
  /** Attach to a hidden canvas. This surface is what gets filmed. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Begin painting and filming one shot's countdown. */
  begin: (t: Theme) => void;
  /** Stop filming; whatever was captured is kept against this shot. */
  end: (shotIndex: number) => void;
  /** Forget the previous sitting and make room for a new one. */
  reset: (shots: number) => void;
  /** One clip per shot, in order. Null where the browser produced nothing. */
  clips: (Clip | null)[];
  /** True while a clip is still being finalised. */
  pending: boolean;
}

function usable(video: HTMLVideoElement | null): boolean {
  return (
    video !== null &&
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

/**
 * Films the seven seconds before each flash, so a still can be pressed and
 * watched moving.
 *
 * What is filmed is the COMPOSITE, never either camera: the scene, both of you
 * feathered into it, and the grade over the pair. So a live photo has the same
 * two people in the same light as the still it belongs to, for free — the same
 * painter draws both, and there is no second description of a theme anywhere
 * to fall out of step.
 */
export function useLiveFilm({
  localVideo,
  remoteVideo,
}: {
  localVideo: React.RefObject<HTMLVideoElement | null>;
  remoteVideo: React.RefObject<HTMLVideoElement | null>;
}): LiveFilm {
  // Every ref is declared here, above the callbacks that write to them: the
  // React Compiler refuses a ref first modified inside a closure below it.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const themeRef = useRef<Theme | null>(null);
  const clipsRef = useRef<(Clip | null)[]>([]);

  const [clips, setClips] = useState<(Clip | null)[]>([]);
  const [pending, setPending] = useState(0);

  /**
   * A flipped copy of the local camera.
   *
   * You pose against a mirror of yourself, so a recording that came back
   * unflipped would not be the thing you were watching while you posed. The
   * still capture already does this; the film has to agree with it or the two
   * halves of one keepsake would disagree about which way you were facing.
   */
  const mirrored = useCallback((): HTMLCanvasElement | null => {
    const video = localVideo.current;
    if (!usable(video) || video === null) return null;

    const width = Math.min(video.videoWidth, SCRATCH_WIDTH);
    const height = Math.round((video.videoHeight / video.videoWidth) * width);
    let scratch = scratchRef.current;
    if (scratch === null) {
      scratch = document.createElement("canvas");
      scratchRef.current = scratch;
    }
    // Reused across frames rather than allocated per frame: at twenty-four
    // frames a second a fresh canvas each time is work for the collector that
    // shows up as a stutter in the very recording it is spoiling.
    if (scratch.width !== width || scratch.height !== height) {
      scratch.width = width;
      scratch.height = height;
    }
    const ctx = scratch.getContext("2d");
    if (ctx === null) return null;

    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();
    return scratch;
  }, [localVideo]);

  /** One frame of the composite. The loop that repeats it lives in `begin`. */
  const paintOnce = useCallback(() => {
    const canvas = canvasRef.current;
    const t = themeRef.current;
    if (canvas === null || t === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const remote = remoteVideo.current;
    paintShot(
      ctx,
      t,
      { left: mirrored(), right: usable(remote) ? remote : null },
      { width: canvas.width, height: canvas.height },
    );
  }, [mirrored, remoteVideo]);

  const stopPainting = useCallback(() => {
    if (rafRef.current === null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const begin = useCallback(
    (t: Theme) => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      canvas.width = LIVE_WIDTH;
      canvas.height = Math.round(LIVE_WIDTH / PANEL_ASPECT);
      themeRef.current = t;

      // The loop is a plain local function rather than a hook value, so it can
      // name itself for the next frame. A useCallback that scheduled itself
      // would be reading its own binding before it is declared.
      const loop = () => {
        paintOnce();
        rafRef.current = requestAnimationFrame(loop);
      };

      // One frame painted before filming starts, so the recording opens on the
      // scene rather than on a blank canvas.
      stopPainting();
      loop();

      recordingRef.current?.cancel();
      recordingRef.current = startRecording(canvas);
    },
    [paintOnce, stopPainting],
  );

  const end = useCallback(
    (shotIndex: number) => {
      stopPainting();
      const recording = recordingRef.current;
      recordingRef.current = null;
      themeRef.current = null;
      if (recording === null) return;

      setPending((n) => n + 1);
      void recording.stop().then((clip) => {
        // Guard the index: a sitting reset while a clip was being finalised
        // would otherwise grow the array back and offer a keepsake from an
        // evening that has already been thrown away.
        if (shotIndex < clipsRef.current.length) {
          clipsRef.current[shotIndex] = clip;
          setClips([...clipsRef.current]);
        }
        setPending((n) => Math.max(0, n - 1));
      });
    },
    [stopPainting],
  );

  const reset = useCallback(
    (shots: number) => {
      stopPainting();
      recordingRef.current?.cancel();
      recordingRef.current = null;
      themeRef.current = null;
      clipsRef.current = Array.from({ length: shots }, () => null);
      setClips([...clipsRef.current]);
    },
    [stopPainting],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      recordingRef.current?.cancel();
    };
  }, []);

  return { canvasRef, begin, end, reset, clips, pending: pending > 0 };
}
