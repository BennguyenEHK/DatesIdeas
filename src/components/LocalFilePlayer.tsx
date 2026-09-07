"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PlayerHandle } from "@/lib/media/player";

interface LocalFilePlayerProps {
  file: File | null;
  onDuration: (seconds: number | null) => void;
  onError: (message: string) => void;
  /**
   * Called when the picture genuinely starts moving, which is not when play()
   * was called.
   *
   * An element asked to play has to decode and spin up first, by a different
   * amount on each machine, and until it does its position does not move. The
   * sync layer stamps the shared position at the moment it ASKS -- so whoever
   * starts slower opens the song behind, and a check made straight after the
   * request cannot see it, because the error does not exist yet. This is the
   * first instant at which it does.
   */
  onStarted?: () => void;
}

/**
 * How long after reporting a start to ignore another one.
 *
 * A correction moves the position, and a browser is free to answer that with
 * another `playing` event -- which would ask for another correction, which
 * moves the position again. The two settle in practice, because a corrected
 * player has nothing left to correct, but "in practice" is not a guarantee and
 * the failure would be a locked-up video. A real start-up happens once.
 */
const START_REPORT_GAP_MS = 500;

export const LocalFilePlayer = forwardRef<PlayerHandle, LocalFilePlayerProps>(
  function LocalFilePlayer({ file, onDuration, onError, onStarted }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const volumeRef = useRef(100);
    const onDurationRef = useRef(onDuration);
    const onErrorRef = useRef(onError);
    const onStartedRef = useRef(onStarted);
    const lastStartReport = useRef(0);

    // Keep event handlers current without making the object URL effect recreate
    // a gigabyte-sized source just because a parent supplied a new callback.
    useEffect(() => {
      onDurationRef.current = onDuration;
      onErrorRef.current = onError;
      onStartedRef.current = onStarted;
    });

    useEffect(() => {
      const video = videoRef.current;

      if (!file) {
        // Clearing the source tells the browser to release its decoder before
        // the already-revoked URL can be accidentally reused.
        video?.removeAttribute("src");
        onDurationRef.current(null);
        return;
      }

      if (!video) return;

      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
      // The volume belongs to this viewer, so it must follow a newly attached
      // film even when it was chosen before the first film became ready.
      video.volume = volumeRef.current / 100;

      return () => {
        // Object URLs retain the entire local file until explicitly revoked.
        URL.revokeObjectURL(objectUrl);
      };
    }, [file]);

    useImperativeHandle(
      ref,
      () => ({
        isReady: () => {
          const video = videoRef.current;
          return Boolean(video?.src) && (video?.readyState ?? 0) >= 1;
        },
        load: (_videoId, startSec) => {
          const video = videoRef.current;
          if (!video || !video.src || video.readyState < 1) return;
          // The local side already chose its File, so the shared id cannot
          // select a source here; only the synchronized start position matters.
          video.currentTime = startSec;
        },
        play: () => {
          const video = videoRef.current;
          if (!video) return;
          // Browsers may reject play() until the viewer has interacted; that
          // local policy must not break synchronization for the other side.
          //
          // Optional-chained because play() is only specified to return a
          // promise in engines that implement the modern signature; older ones
          // return nothing, and calling .catch on that throws out of a handle
          // the sync layer expects never to throw.
          void video.play()?.catch(() => {});
        },
        pause: () => {
          videoRef.current?.pause();
        },
        seek: (seconds) => {
          const video = videoRef.current;
          if (video) video.currentTime = seconds;
        },
        nudge: (seconds) => {
          const video = videoRef.current;
          if (video) video.currentTime = seconds;
        },
        setRate: (rate) => {
          const video = videoRef.current;
          if (!video) return false;
          // A small tempo correction should repair sync, not make the singer
          // sound flat; engines without this optional property still ramp.
          if ("preservesPitch" in video) video.preservesPitch = true;
          video.playbackRate = rate;
          return true;
        },
        currentTime: () => {
          const video = videoRef.current;
          return video && video.readyState >= 1 ? video.currentTime : 0;
        },
        setVolume: (percent) => {
          const clamped = Math.min(100, Math.max(0, Math.round(percent)));
          volumeRef.current = clamped;
          const video = videoRef.current;
          if (video) video.volume = clamped / 100;
        },
      }),
      [],
    );

    if (!file) return null;

    return (
      <video
        ref={videoRef}
        muted={false}
        playsInline
        className="h-full w-full object-contain"
        onLoadedMetadata={(event) => {
          onDurationRef.current(event.currentTarget.duration);
        }}
        onPlaying={() => {
          const at = Date.now();
          if (at - lastStartReport.current < START_REPORT_GAP_MS) return;
          lastStartReport.current = at;
          onStartedRef.current?.();
        }}
        onError={() => {
          onErrorRef.current(
            `Could not play ${file.name} because this browser cannot decode the file.`,
          );
        }}
      />
    );
  },
);
