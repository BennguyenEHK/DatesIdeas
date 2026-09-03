"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boothTimeline, COUNT_FROM } from "./booth";
import { captureFrame, frameToBlob, type Frame } from "./capture";
import { paintStrip, shotPreview, type Shot } from "./paint";
import { cutOutOrOriginal } from "./segment";
import { useLiveFilm } from "./useLiveFilm";
import { buildLiveStrip } from "./liveStrip";
import { stripLayout, type ShotCount } from "./strip";
import { DEFAULT_THEME_ID, theme as themeById, type ThemeId } from "./themes";
import type { SyncedClock } from "@/lib/sync/SyncedClock";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** How long the flash stays white. Long enough to see, short enough to blink. */
const FLASH_MS = 420;
/**
 * A moment's head start before the countdown begins, so the message announcing
 * the sitting arrives before the instant it describes. Without it the peer
 * schedules a countdown that has already begun and drops straight to a number
 * or two in.
 */
const ANNOUNCE_LEAD_MS = 400;

export interface Booth {
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  shots: ShotCount;
  setShots: (n: ShotCount) => void;
  /** The number currently on screen, or null between counts. */
  count: number | null;
  /** The photograph just taken, held up before the next countdown. */
  review: { shotIndex: number; frame: Frame | null } | null;
  flashing: boolean;
  running: boolean;
  /** Between the last flash and the strip being ready. */
  busy: boolean;
  stripUrl: string | null;
  /** Attach to a hidden canvas: the surface the live photo is filmed from. */
  filmCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** True when this sitting produced at least one live photo. */
  hasClip: boolean;
  /** True while a clip is still being finalised after the last flash. */
  clipPending: boolean;
  /**
   * Stitches the shots' clips into one moving strip.
   *
   * Built on demand rather than after every sitting: it costs about twelve
   * seconds of painting and recording, and most evenings nobody asks for it.
   */
  liveStrip: () => Promise<Blob | null>;
  start: () => void;
  accept: (msg: PeerMessage) => void;
  save: () => void;
  discard: () => void;
}

/**
 * Runs a photo booth sitting on both sides at once.
 *
 * The only thing that travels is the instant the sitting starts. From that one
 * number both computers derive the identical countdown and the identical
 * flashes, and each builds the whole strip out of the two video feeds it
 * already has on screen. No picture is ever sent anywhere, which is why a
 * strip costs the call nothing at all.
 */
export function useBooth({
  clock,
  send,
  localVideo,
  remoteVideo,
  caption,
}: {
  clock: SyncedClock | null;
  send: (m: PeerMessage) => void;
  localVideo: React.RefObject<HTMLVideoElement | null>;
  remoteVideo: React.RefObject<HTMLVideoElement | null>;
  /** Stamped along the bottom of the strip: the date and the room. */
  caption: string;
}): Booth {
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [shots, setShots] = useState<ShotCount>(4);
  const [count, setCount] = useState<number | null>(null);
  const [review, setReview] = useState<{ shotIndex: number; frame: Frame | null } | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stripUrl, setStripUrl] = useState<string | null>(null);

  const film = useLiveFilm({ localVideo, remoteVideo });

  // Declared above every callback that writes to them: the React Compiler
  // refuses a ref modified below the hook that closes over it.
  const captured = useRef<{ left: Frame | null; right: Frame | null }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clockRef = useRef(clock);
  const sendRef = useRef(send);
  const captionRef = useRef(caption);
  useEffect(() => {
    clockRef.current = clock;
    sendRef.current = send;
    captionRef.current = caption;
  });

  useEffect(() => {
    // Copied by reference on purpose, which is what the lint is asking for and
    // is safe here: the array is only ever pushed to and emptied in place,
    // never reassigned, so this is the same array at unmount as it is now.
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
    };
  }, []);

  const at = useCallback((when: number, fn: () => void) => {
    // Booth sittings deliberately last longer than reaction scheduling permits;
    // measure against the shared clock but own these long-lived timers locally.
    const delay = Math.max(0, when - (clockRef.current?.now() ?? Date.now()));
    const id = setTimeout(fn, delay);
    timers.current.push(id);
  }, []);

  const develop = useCallback(async (id: ThemeId, n: ShotCount) => {
    setBusy(true);
    try {
      const t = themeById(id);
      const layout = stripLayout(n);

      // The cut-out, and the only place it happens: a handful of stills that
      // have already been taken, never a live frame. That is what makes
      // background removal affordable on top of face and hand tracking.
      const painted: Shot[] = [];
      for (const pair of captured.current) {
        painted.push({
          left: pair.left ? (await cutOutOrOriginal(pair.left)).canvas : null,
          right: pair.right ? (await cutOutOrOriginal(pair.right)).canvas : null,
        });
      }

      const canvas = document.createElement("canvas");
      canvas.width = layout.width;
      canvas.height = layout.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      paintStrip(ctx, layout, t, painted, captionRef.current);

      const blob = await frameToBlob(
        { canvas, width: layout.width, height: layout.height },
        "image/png",
      );
      if (!blob) return;
      setStripUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch {
      // A strip that fails to develop is a disappointment, not a broken call.
    } finally {
      setBusy(false);
      setRunning(false);
    }
  }, []);

  const run = useCallback(
    (id: ThemeId, n: ShotCount, startAt: number) => {
      setRunning(true);
      setCount(null);
      setReview(null);
      // Each sitting starts from nothing. Without this the list grows by a
      // timer per flash for the whole evening, and unmount walks all of them.
      for (const id of timers.current) clearTimeout(id);
      timers.current.length = 0;
      captured.current = Array.from({ length: n }, () => ({
        left: null,
        right: null,
      }));
      film.reset(n);

      for (const step of boothTimeline(startAt, n)) {
        at(step.at, () => {
          if (step.kind === "count") {
            // The clip IS the countdown, so filming opens on the same instant
            // as the first number rather than a frame either side of it.
            if (step.value === COUNT_FROM) film.begin(themeById(id));
            setCount(step.value);
            return;
          }
          if (step.kind === "flash") {
            // Ended before the still is taken, so the clip finishes on the
            // last moment of posing rather than on the white of the flash.
            film.end(step.shotIndex);
            setCount(null);
            setFlashing(true);
            // Mirrored to match the preview: you posed against a mirror of
            // yourself, and a photograph that comes back unflipped is not the
            // one you posed for.
            captured.current[step.shotIndex] = {
              left: captureFrame(localVideo.current, { mirrored: true }),
              right: captureFrame(remoteVideo.current),
            };
            const off = setTimeout(() => setFlashing(false), FLASH_MS);
            timers.current.push(off);
            return;
          }
          if (step.kind === "review") {
            // Built from the two stills the flash just took, never from a new
            // draw off the video: the picture held up has to be the instant
            // both sides synchronized around, not a moment later.
            //
            // Both of you, side by side, in the scene. This used to hold up
            // `.left` alone -- which on your screen is you and on theirs is
            // them, so neither of you ever saw the two of you together until
            // the strip finally developed.
            const pair = captured.current[step.shotIndex];
            const canvas = shotPreview(themeById(id), {
              left: pair.left?.canvas ?? null,
              right: pair.right?.canvas ?? null,
            });
            setReview({
              shotIndex: step.shotIndex,
              frame:
                canvas === null
                  ? null
                  : { canvas, width: canvas.width, height: canvas.height },
            });
            return;
          }
          if (step.kind === "reviewEnd") {
            setReview(null);
            return;
          }
          setReview(null);
          void develop(id, n);
        });
      }
    },
    [at, develop, film, localVideo, remoteVideo],
  );

  const start = useCallback(() => {
    const now = clockRef.current?.now() ?? Date.now();
    const startAt = now + ANNOUNCE_LEAD_MS;
    sendRef.current({ t: "photo", themeId, shots, startAt });
    run(themeId, shots, startAt);
  }, [themeId, shots, run]);

  const accept = useCallback(
    (msg: PeerMessage) => {
      if (msg.t !== "photo") return;
      // Their choice of look and length, so both strips match.
      setThemeId(msg.themeId);
      setShots(msg.shots);
      run(msg.themeId, msg.shots, msg.startAt);
    },
    [run],
  );

  const save = useCallback(() => {
    if (!stripUrl) return;
    const a = document.createElement("a");
    a.href = stripUrl;
    a.download = `festibooth-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }, [stripUrl]);

  const discard = useCallback(() => {
    setStripUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }, []);

  /**
   * The moving strip: every shot's clip playing at once in the strip's own
   * layout, filmed as one video.
   *
   * Object URLs are minted here and handed over to be revoked by the builder,
   * because a forgotten one pins its blob in memory for the life of the page
   * and these blobs run to tens of megabytes.
   */
  const liveStrip = useCallback(async (): Promise<Blob | null> => {
    const clips = film.clips;
    if (!clips.some((clip) => clip !== null)) return null;

    const longest = clips.reduce(
      (most, clip) => Math.max(most, clip?.durationMs ?? 0),
      0,
    );

    const result = await buildLiveStrip(
      {
        clipUrls: clips.map((clip) =>
          clip === null ? null : URL.createObjectURL(clip.blob),
        ),
        shots,
        theme: themeById(themeId),
        caption: captionRef.current,
        durationMs: longest,
      },
      {
        makeVideo: (src) => {
          const video = document.createElement("video");
          video.src = src;
          video.playsInline = true;
          return video;
        },
        makeCanvas: (width, height) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          return canvas;
        },
        onFrame: (fn) => requestAnimationFrame(fn),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
        now: () => Date.now(),
        revoke: (url) => URL.revokeObjectURL(url),
      },
    );

    return result?.blob ?? null;
  }, [film.clips, shots, themeId]);

  return {
    themeId,
    setThemeId,
    shots,
    setShots,
    count,
    review,
    flashing,
    running,
    busy,
    stripUrl,
    filmCanvasRef: film.canvasRef,
    hasClip: film.clips.some((c) => c !== null),
    clipPending: film.pending,
    liveStrip,
    start,
    accept,
    save,
    discard,
  };
}
