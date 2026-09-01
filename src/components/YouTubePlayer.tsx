"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PlayerHandle } from "@/lib/media/player";

/* ---------------------------------------------------------------------------
 * Minimal local surface of the YouTube IFrame Player API -- just the bits
 * this component touches. No @types package exists for it and we're not
 * adding one.
 * ------------------------------------------------------------------------- */

interface YTPlayerInstance {
  destroy(): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
}

interface YTPlayerEvent {
  target: YTPlayerInstance;
}

interface YTStateChangeEvent {
  data: number;
}

interface YTPlayerOptions {
  height: string;
  width: string;
  playerVars: {
    controls: 0 | 1;
    rel: 0 | 1;
    playsinline: 0 | 1;
    modestbranding: 0 | 1;
    disablekb: 0 | 1;
    origin: string;
  };
  events: {
    onReady: (event: YTPlayerEvent) => void;
    onStateChange: (event: YTStateChangeEvent) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement, options: YTPlayerOptions) => YTPlayerInstance;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/* ---------------------------------------------------------------------------
 * Single, page-wide load of the IFrame API.
 *
 * YouTube's iframe_api script fires exactly one global callback,
 * window.onYouTubeIframeAPIReady, exactly once per script load. Two problems
 * follow if every mount of this component tried to load the API itself:
 *   - Overwriting the callback: a second mount that clobbers
 *     onYouTubeIframeAPIReady before the first one has fired leaves the first
 *     player's promise unresolved forever.
 *   - Re-appending the <script>: the browser (and YouTube's own script) does
 *     not re-run iframe_api's init logic for a second <script src> once the
 *     first has already loaded, so the callback never fires a second time --
 *     a naive "load on every mount" approach hangs on remount.
 * A module-level promise sidesteps both: the first caller creates it and
 * appends the script; every later caller (including remounts after unmount)
 * just awaits the same promise, chaining onto any callback that's already
 * registered rather than replacing it.
 * ------------------------------------------------------------------------- */

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    const existing = window.YT;
    if (existing?.Player) {
      resolve(existing);
      return;
    }

    // Chain onto whatever callback is already registered instead of
    // overwriting it -- see module-level comment above.
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      const YT = window.YT;
      if (YT) resolve(YT);
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });

  return apiPromise;
}

export const YouTubePlayer = forwardRef<
  PlayerHandle,
  {
    onReady?: () => void;
    onStateChange?: (playing: boolean) => void;
  }
>(function YouTubePlayer({ onReady, onStateChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const readyRef = useRef(false);

  // Latest callbacks in refs so the mount effect below can stay []-deps --
  // it must run exactly once, since it's what drives the single-load API
  // fetch and player construction.
  const onReadyRef = useRef(onReady);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onReadyRef.current = onReady;
    onStateChangeRef.current = onStateChange;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let player: YTPlayerInstance | null = null;

    loadYouTubeIframeApi().then((YT) => {
      // Unmounted while the (possibly shared, possibly already-resolved)
      // API promise was pending -- don't construct a player nobody wants.
      if (cancelled) return;

      player = new YT.Player(container, {
        height: "100%",
        width: "100%",
        playerVars: {
          controls: 0,
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
          disablekb: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            playerRef.current = player;
            readyRef.current = true;
            onReadyRef.current?.();
          },
          onStateChange: (event) => {
            if (cancelled) return;
            // BUFFERING and CUED are deliberately ignored: reporting either
            // as "paused" would make the sync layer fight the buffer.
            if (event.data === YT.PlayerState.PLAYING) {
              onStateChangeRef.current?.(true);
            } else if (
              event.data === YT.PlayerState.PAUSED ||
              event.data === YT.PlayerState.ENDED
            ) {
              onStateChangeRef.current?.(false);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      playerRef.current = null;
      player?.destroy();
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      isReady: () => readyRef.current,
      load: (videoId, startSec) => {
        if (!readyRef.current || !playerRef.current) return;
        // cueVideoById, not loadVideoById: both sides of the call need to
        // start on a shared clock, so only play() is allowed to start it.
        playerRef.current.cueVideoById(videoId, startSec);
      },
      play: () => {
        if (!readyRef.current || !playerRef.current) return;
        playerRef.current.playVideo();
      },
      pause: () => {
        if (!readyRef.current || !playerRef.current) return;
        playerRef.current.pauseVideo();
      },
      seek: (seconds) => {
        if (!readyRef.current || !playerRef.current) return;
        playerRef.current.seekTo(seconds, true);
      },
      currentTime: () => {
        if (!readyRef.current || !playerRef.current) return 0;
        return playerRef.current.getCurrentTime();
      },
    }),
    [],
  );

  // Fills whatever sized box the parent gives it; no aspect ratio or max
  // width of its own. The child-selector rules pin the iframe YT.Player
  // injects to the same box, since its own width/height options are only
  // honoured as iframe attributes, not guaranteed layout.
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:h-full [&>iframe]:w-full"
    />
  );
});
