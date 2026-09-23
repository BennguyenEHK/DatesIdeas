"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { START_REPORT_GAP_MS, type PlayerHandle } from "@/lib/media/player";

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
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  cuePlaylist(options: { listType: "playlist"; list: string }): void;
  /** The ids of the cued playlist, or null until YouTube has read it. */
  getPlaylist(): string[] | null;
}

interface YTPlayerEvent {
  target: YTPlayerInstance;
}

interface YTStateChangeEvent {
  data: number;
}

/**
 * YouTube reports refusals here rather than by failing to load. Without a
 * handler the iframe simply shows its own error card, which says nothing about
 * what to do next.
 */
interface YTErrorEvent {
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
    onError: (event: YTErrorEvent) => void;
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

/** How often, and for how long, to wait for YouTube to read a playlist. */
const PLAYLIST_POLL_MS = 250;
const PLAYLIST_POLLS = 20;

/**
 * The sync layer's handle, plus what only a YouTube player can do.
 *
 * Kept apart from PlayerHandle so the sync layer and the local-file player
 * never have to pretend to know about playlists.
 */
export interface YouTubePlayerHandle extends PlayerHandle {
  /**
   * The video ids in a public playlist, read by the player itself so no API
   * key is needed. Empty when YouTube could not read it within five seconds.
   *
   * Whatever was cued before is put back afterwards, at the same place and
   * playing if it was, so the sync layer -- which believes that video is still
   * loaded -- is not left talking to a player showing something else.
   */
  expandPlaylist(listId: string): Promise<string[]>;
  /** Length of the cued video in seconds, or null before YouTube knows it. */
  duration(): number | null;
}

/** What the player was doing when a playlist borrowed it. */
interface Parked {
  videoId: string | null;
  at: number;
  playing: boolean;
}

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  {
    onReady?: () => void;
    onStateChange?: (playing: boolean) => void;
    /**
     * Playback has genuinely begun, as opposed to having been asked to.
     *
     * The sync layer stamps a position when play() is CALLED, and YouTube does
     * not start at that instant -- it fetches, decodes and spins up, by a
     * different amount on each machine and each connection. Until this was
     * reported, the whole of that start-up delay went unmeasured until the
     * drift timer next came round, at which point it was large enough to be
     * corrected with a seek: the film visibly jumping backwards to catch up
     * with itself, and losing the buffer it had just filled.
     */
    onStarted?: () => void;
    onError?: (code: number) => void;
    /**
     * The video reached its end, with the id of the video that ended.
     *
     * Once per ending: YouTube may repeat ENDED, and every repeat would move a
     * music queue on by another song. The id lets a caller notice that the
     * other screen has already moved past that song.
     */
    onEnded?: (videoId: string | null) => void;
  }
>(function YouTubePlayer(
  { onReady, onStateChange, onStarted, onError, onEnded },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const readyRef = useRef(false);
  // Remembered rather than dropped: the volume is chosen before YouTube
  // finishes loading, and a setting silently lost is worse than a late one.
  const volumeRef = useRef(100);

  // Latest callbacks in refs so the mount effect below can stay []-deps --
  // it must run exactly once, since it's what drives the single-load API
  // fetch and player construction.
  const onReadyRef = useRef(onReady);
  const onStateChangeRef = useRef(onStateChange);
  const onStartedRef = useRef(onStarted);
  const onErrorRef = useRef(onError);
  const onEndedRef = useRef(onEnded);
  // Set on ENDED and cleared on the next PLAYING, so one ending is reported
  // once however many times YouTube announces it.
  const endReported = useRef(false);
  // The last video cued through the handle, which is the one an ENDED is about.
  const cuedId = useRef<string | null>(null);
  // Non-null while a playlist is being read. The sync layer keeps sending
  // commands meanwhile; they are written here instead of reaching a player
  // that is showing the playlist, and applied when the video is put back.
  const parked = useRef<Parked | null>(null);
  // A correction seeks, and YouTube answers a seek with another PLAYING event.
  // Reporting that as a fresh start would ask for another correction, which
  // seeks again. A real start-up happens once.
  const lastStartReport = useRef(0);
  useEffect(() => {
    onReadyRef.current = onReady;
    onStateChangeRef.current = onStateChange;
    onStartedRef.current = onStarted;
    onErrorRef.current = onError;
    onEndedRef.current = onEnded;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let player: YTPlayerInstance | null = null;

    /**
     * A node built by hand, deliberately, so that React has never heard of it.
     *
     * YouTube's API replaces the element it is given with an iframe. Handing it
     * the div React rendered leaves React's record of the tree pointing at a
     * node that is no longer in the document, and the next time React tries to
     * remove that node -- which happens the instant a fetched karaoke track
     * becomes ready and the panel swaps this player for the local video one --
     * it fails with "The node to be removed is not a child of this node" and
     * takes the whole room down with it.
     *
     * So the sacrifice is this child instead. React owns the container and
     * nothing inside it, which leaves YouTube free to replace, rebuild or
     * remove its own node as often as it likes.
     */
    const mountPoint = document.createElement("div");
    mountPoint.style.height = "100%";
    mountPoint.style.width = "100%";
    container.appendChild(mountPoint);

    loadYouTubeIframeApi().then((YT) => {
      // Unmounted while the (possibly shared, possibly already-resolved)
      // API promise was pending -- don't construct a player nobody wants.
      if (cancelled) return;

      player = new YT.Player(mountPoint, {
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
            player?.setVolume(volumeRef.current);
            onReadyRef.current?.();
          },
          onStateChange: (event) => {
            if (cancelled) return;
            // BUFFERING and CUED are deliberately ignored: reporting either
            // as "paused" would make the sync layer fight the buffer.
            if (event.data === YT.PlayerState.PLAYING) {
              endReported.current = false;
              onStateChangeRef.current?.(true);
              const at = Date.now();
              if (at - lastStartReport.current >= START_REPORT_GAP_MS) {
                lastStartReport.current = at;
                onStartedRef.current?.();
              }
            } else if (
              event.data === YT.PlayerState.PAUSED ||
              event.data === YT.PlayerState.ENDED
            ) {
              onStateChangeRef.current?.(false);
              if (event.data === YT.PlayerState.ENDED && !endReported.current) {
                endReported.current = true;
                onEndedRef.current?.(cuedId.current);
              }
            }
          },
          onError: (event) => {
            if (cancelled) return;
            onErrorRef.current?.(event.data);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      playerRef.current = null;
      player?.destroy();
      // Whatever YouTube left behind goes too. destroy() removes its iframe,
      // but the player may never have been built -- the API promise can still
      // be pending here -- and in that case the bare mount point is still
      // sitting in a container React is about to reuse.
      container.replaceChildren();
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      isReady: () => readyRef.current,
      load: (videoId, startSec) => {
        if (parked.current) {
          parked.current = { videoId, at: startSec, playing: false };
          return;
        }
        if (!readyRef.current || !playerRef.current) return;
        cuedId.current = videoId;
        // cueVideoById, not loadVideoById: both sides of the call need to
        // start on a shared clock, so only play() is allowed to start it.
        playerRef.current.cueVideoById(videoId, startSec);
      },
      play: () => {
        if (parked.current) {
          parked.current.playing = true;
          return;
        }
        if (!readyRef.current || !playerRef.current) return;
        playerRef.current.playVideo();
      },
      pause: () => {
        if (parked.current) {
          parked.current.playing = false;
          return;
        }
        if (!readyRef.current || !playerRef.current) return;
        playerRef.current.pauseVideo();
      },
      seek: (seconds) => {
        if (parked.current) {
          parked.current.at = seconds;
          return;
        }
        if (!readyRef.current || !playerRef.current) return;
        playerRef.current.seekTo(seconds, true);
      },
      nudge: (seconds) => {
        if (parked.current) {
          parked.current.at = seconds;
          return;
        }
        if (!readyRef.current || !playerRef.current) return;
        playerRef.current.seekTo(seconds, false);
      },
      setRate: () => {
        // YouTube rounds unsupported rates towards 1, so a 3% correction
        // silently becomes no correction at all and leaves drift unresolved.
        return false;
      },
      setVolume: (percent) => {
        const clamped = Math.min(100, Math.max(0, Math.round(percent)));
        // Stored either way, so a level chosen while YouTube is still loading
        // is applied on ready rather than quietly discarded.
        volumeRef.current = clamped;
        if (readyRef.current && playerRef.current) {
          playerRef.current.setVolume(clamped);
        }
      },
      currentTime: () => {
        if (parked.current) return parked.current.at;
        if (!readyRef.current || !playerRef.current) return 0;
        return playerRef.current.getCurrentTime();
      },
      duration: () => {
        if (parked.current || !readyRef.current || !playerRef.current)
          return null;
        const seconds = playerRef.current.getDuration();
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
      },
      expandPlaylist: (listId) =>
        new Promise<string[]>((resolve) => {
          const player = playerRef.current;
          // One playlist at a time: a second one would park the first one's
          // playlist as if it were the song to go back to.
          if (!readyRef.current || !player || parked.current) {
            resolve([]);
            return;
          }
          const playingState = window.YT?.PlayerState.PLAYING;
          parked.current = {
            videoId: cuedId.current,
            at: player.getCurrentTime(),
            playing:
              playingState !== undefined &&
              player.getPlayerState() === playingState,
          };
          player.cuePlaylist({ listType: "playlist", list: listId });

          let polls = 0;
          const timer = setInterval(() => {
            polls += 1;
            const current = playerRef.current;
            const ids = current?.getPlaylist() ?? null;
            const found = ids !== null && ids.length > 0;
            // Unmounted, found, or out of patience: all three end the wait.
            if (!found && polls < PLAYLIST_POLLS && current) return;

            clearInterval(timer);
            const back = parked.current;
            parked.current = null;
            if (current && back?.videoId) {
              cuedId.current = back.videoId;
              current.cueVideoById(back.videoId, back.at);
              if (back.playing) current.playVideo();
            }
            resolve(found ? [...ids] : []);
          }, PLAYLIST_POLL_MS);
        }),
    }),
    [],
  );

  // Fills whatever sized box the parent gives it; no aspect ratio or max
  // width of its own. The descendant rules pin the iframe YT.Player injects to
  // the same box, since its own width/height options are only honoured as
  // iframe attributes, not guaranteed layout.
  //
  // Deliberately empty, and it must stay that way: everything inside is put
  // there by the effect above and owned by YouTube, so a child rendered here
  // would be a node React expects to find and YouTube is free to remove.
  // Descendant rather than child selectors, because whether the iframe ends up
  // beside the mount point or inside it is YouTube's business, not ours.
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full"
    />
  );
});
