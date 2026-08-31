"use client";

import { useEffect, useRef, useState } from "react";
import { GestureTracker } from "./gestures";
import type { VisionFrame } from "./types";
import type { MemeId } from "@/lib/rtc/protocol";

/**
 * Pumps frames from the local camera into the MediaPipe worker and turns the
 * results into gesture events. If the worker fails to start, gesture SENDING
 * is disabled and the session continues — the partner's memes still arrive.
 */
export function useGestureDetection(
  stream: MediaStream | null,
  onGesture: (id: MemeId) => void,
) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onGestureRef = useRef(onGesture);
  useEffect(() => {
    onGestureRef.current = onGesture;
  });

  useEffect(() => {
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
    let inFlight = false;
    let handle = 0;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "ready") {
        setReady(true);
      } else if (msg.type === "error") {
        setError(msg.message);
        setReady(false);
      } else if (msg.type === "frame") {
        inFlight = false;
        for (const id of tracker.update(msg.frame as VisionFrame)) {
          onGestureRef.current(id);
        }
      }
    };
    worker.postMessage({ type: "init" });

    const pump = async (_now: number, meta: { mediaTime: number }) => {
      if (stopped) return;
      // Drop frames while inference is busy rather than queueing behind it.
      if (!inFlight && ready) {
        inFlight = true;
        try {
          const bitmap = await createImageBitmap(video);
          worker.postMessage({ type: "frame", bitmap, timestamp: meta.mediaTime * 1000 }, [bitmap]);
        } catch {
          inFlight = false;
        }
      }
      handle = video.requestVideoFrameCallback(pump);
    };

    void video.play().then(() => {
      handle = video.requestVideoFrameCallback(pump);
    });

    return () => {
      stopped = true;
      if (handle) video.cancelVideoFrameCallback(handle);
      video.srcObject = null;
      worker.terminate();
    };
  }, [stream, ready]);

  return { ready, error };
}
