"use client";

import { useEffect, useRef, useState } from "react";
import { GestureTracker } from "./gestures";
import type { VisionFrame } from "./types";
import type { MemeId } from "@/lib/rtc/protocol";

/** How long an unanswered frame may block the pump before it gives up on it. */
const FRAME_TIMEOUT_MS = 2000;
/** Poll rate where requestVideoFrameCallback is missing. Firefox lands here. */
const FALLBACK_INTERVAL_MS = 50;

/**
 * Pumps frames from the local camera into the MediaPipe worker and turns the
 * results into gesture events. If the worker fails to start, gesture SENDING
 * is disabled and the session continues — the partner's memes still arrive.
 *
 * `enabled` is this device's own switch. Turning it off stops the analysis
 * outright rather than muting its output, and it is never sent to the peer:
 * the other side keeps making gestures, and this side keeps seeing them.
 */
export function useGestureDetection(
  stream: MediaStream | null,
  onGesture: (id: MemeId) => void,
  enabled: boolean,
) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onGestureRef = useRef(onGesture);
  useEffect(() => {
    onGestureRef.current = onGesture;
  });

  useEffect(() => {
    if (!enabled) return;
    if (!stream || stream.getVideoTracks().length === 0) return;

    const worker = new Worker(new URL("./gesture.worker.ts", import.meta.url), {
      type: "module",
    });
    const tracker = new GestureTracker();
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    let stopped = false;
    // Readiness is a local, NOT the `ready` state. Reading state here would put
    // it in this effect's dependencies, and the effect would then tear down the
    // very worker that had just reported itself ready.
    let workerReady = false;
    let inFlight = false;
    let sentAt = 0;
    let frameHandle = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "ready") {
        workerReady = true;
        setReady(true);
      } else if (msg.type === "error") {
        setError(msg.message);
        setReady(false);
      } else if (msg.type === "idle") {
        // The worker could not process that frame. Releasing the slot here is
        // what stops one dropped frame from wedging the pump for good.
        inFlight = false;
      } else if (msg.type === "frame") {
        inFlight = false;
        for (const id of tracker.update(msg.frame as VisionFrame)) {
          onGestureRef.current(id);
        }
      }
    };
    worker.postMessage({ type: "init" });

    const pump = () => {
      if (stopped || !workerReady) return;
      const now = performance.now();
      // A reply went missing. Recover rather than stalling forever.
      if (inFlight && now - sentAt > FRAME_TIMEOUT_MS) inFlight = false;
      // Drop frames while inference is busy rather than queueing behind it.
      if (inFlight) return;

      inFlight = true;
      sentAt = now;
      createImageBitmap(video).then(
        (bitmap) => {
          if (stopped) {
            bitmap.close();
            return;
          }
          worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
        },
        () => {
          inFlight = false;
        },
      );
    };

    const start = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        const step = () => {
          pump();
          if (!stopped) frameHandle = video.requestVideoFrameCallback(step);
        };
        frameHandle = video.requestVideoFrameCallback(step);
      } else {
        // Firefox has no requestVideoFrameCallback. Poll the element instead.
        interval = setInterval(pump, FALLBACK_INTERVAL_MS);
      }
    };

    // Autoplay can be refused; the track is live either way, so pump regardless.
    void video.play().then(start, start);

    return () => {
      stopped = true;
      if (frameHandle) video.cancelVideoFrameCallback?.(frameHandle);
      if (interval) clearInterval(interval);
      video.srcObject = null;
      worker.terminate();
      // The worker this readiness referred to is gone. Saying "on" with
      // nothing behind it is the exact lie that hid the original bug — and
      // it would also let a re-enabled switch claim readiness before the
      // replacement worker had finished loading.
      setReady(false);
    };
  }, [stream, enabled]);

  return { ready, error };
}
