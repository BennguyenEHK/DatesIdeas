"use client";

import { useEffect, useRef } from "react";
import { loadLiveSegmenter, type LiveSegmenter } from "@/lib/createspace/liveSegment";
import styles from "./CreateSpace.module.css";

type Panel = { x: number; y: number; width: number; height: number };

export type MergeVideoProps = {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Segmentation is useful only when a real picture exists behind the people. */
  hasBackdrop: boolean;
  panels: readonly Panel[];
};

function crop(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  mirrored: boolean,
): void {
  if (video.videoWidth === 0 || video.videoHeight === 0) return;
  const sourceAspect = video.videoWidth / video.videoHeight;
  const destinationAspect = width / height;
  const sourceWidth =
    sourceAspect > destinationAspect ? video.videoHeight * destinationAspect : video.videoWidth;
  const sourceHeight =
    sourceAspect > destinationAspect ? video.videoHeight : video.videoWidth / destinationAspect;
  const sourceX = (video.videoWidth - sourceWidth) / 2;
  const sourceY = (video.videoHeight - sourceHeight) / 2;

  context.save();
  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  context.restore();
}

function drawFeathered(
  video: HTMLVideoElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mirrored: boolean,
  scratch: HTMLCanvasElement,
): void {
  if (video.videoWidth === 0 || video.videoHeight === 0) return;
  scratch.width = Math.max(1, Math.round(width));
  scratch.height = Math.max(1, Math.round(height));
  const scratchContext = scratch.getContext("2d");
  if (scratchContext === null) return;

  // The booth keeps a soft trace of the room behind a sharper oval portrait.
  context.save();
  context.filter = `blur(${Math.max(1, width * 0.028)}px)`;
  context.globalAlpha = 0.55;
  crop(context, video, width, height, mirrored);
  context.restore();

  scratchContext.clearRect(0, 0, scratch.width, scratch.height);
  crop(scratchContext, video, scratch.width, scratch.height, mirrored);
  scratchContext.save();
  scratchContext.globalCompositeOperation = "destination-in";
  scratchContext.translate(scratch.width * 0.5, scratch.height * 0.46);
  scratchContext.scale(scratch.width * 0.68, scratch.height * 0.82);
  const feather = scratchContext.createRadialGradient(0, 0, 0, 0, 0, 1);
  feather.addColorStop(0.58, "#000000");
  feather.addColorStop(1, "rgba(0, 0, 0, 0)");
  scratchContext.fillStyle = feather;
  scratchContext.fillRect(-1, -1, 2, 2);
  scratchContext.restore();
  context.drawImage(scratch, 0, 0, width, height);
}

export function MergeVideo({ localStream, remoteStream, hasBackdrop, panels }: MergeVideoProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmenterRef = useRef<LiveSegmenter | null>(null);

  useEffect(() => {
    if (localVideoRef.current !== null) localVideoRef.current.srcObject = localStream;
    if (remoteVideoRef.current !== null) remoteVideoRef.current.srcObject = remoteStream;
  }, [localStream, remoteStream]);

  useEffect(() => {
    let alive = true;
    let frame: number | null = null;
    let lastPaint = 0;
    const localScratch = document.createElement("canvas");
    const remoteScratch = document.createElement("canvas");

    if (hasBackdrop) {
      void loadLiveSegmenter().then((loaded) => {
        if (alive) segmenterRef.current = loaded;
        else loaded?.close();
      });
    }

    const draw = (time: number): void => {
      if (!alive || document.hidden) return;
      const output = canvasRef.current;
      const context = output?.getContext("2d");
      if (output !== null && output !== undefined && context !== null && context !== undefined) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = output.clientWidth || 640;
        const height = output.clientHeight || 360;
        const pixelWidth = Math.round(width * ratio);
        const pixelHeight = Math.round(height * ratio);
        if (output.width !== pixelWidth || output.height !== pixelHeight) {
          output.width = pixelWidth;
          output.height = pixelHeight;
        }

        if (time - lastPaint >= 66) {
          lastPaint = time;
          context.setTransform(ratio, 0, 0, ratio, 0, 0);
          context.clearRect(0, 0, width, height);
          for (const panel of panels) {
            const panelWidth = panel.width * width;
            const panelHeight = panel.height * height;
            context.save();
            context.translate(panel.x * width, panel.y * height);
            context.beginPath();
            context.rect(0, 0, panelWidth, panelHeight);
            context.clip();

            const people = [
              { video: localVideoRef.current, x: 0, mirrored: true, scratch: localScratch },
              {
                video: remoteVideoRef.current,
                x: panelWidth / 2,
                mirrored: false,
                scratch: remoteScratch,
              },
            ] as const;
            for (const person of people) {
              if (person.video === null) continue;
              context.save();
              context.translate(person.x, 0);
              context.beginPath();
              context.rect(0, 0, panelWidth / 2, panelHeight);
              context.clip();
              if (segmenterRef.current !== null) {
                segmenterRef.current.draw(
                  person.video,
                  context,
                  panelWidth / 2,
                  panelHeight,
                  person.mirrored,
                );
              } else {
                drawFeathered(
                  person.video,
                  context,
                  panelWidth / 2,
                  panelHeight,
                  person.mirrored,
                  person.scratch,
                );
              }
              context.restore();
            }
            context.restore();
          }
        }
      }
      frame = requestAnimationFrame(draw);
    };

    const resumeWhenVisible = (): void => {
      if (document.hidden) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        return;
      }
      if (frame === null) frame = requestAnimationFrame(draw);
    };

    document.addEventListener("visibilitychange", resumeWhenVisible);
    resumeWhenVisible();
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      if (frame !== null) cancelAnimationFrame(frame);
      segmenterRef.current?.close();
      segmenterRef.current = null;
    };
  }, [hasBackdrop, panels]);

  return (
    <>
      <video ref={localVideoRef} autoPlay muted playsInline className={styles.visuallyHidden} />
      <video ref={remoteVideoRef} autoPlay playsInline className={styles.visuallyHidden} />
      <canvas ref={canvasRef} aria-label="Live merged cameras" className={styles.mergeCanvas} />
    </>
  );
}
