"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HOLD_THRESHOLD_MS,
  MAX_NOTE_MS,
  openCamera,
  startNote,
  stopCamera,
  takePhoto,
  type Facing,
  type NoteRecording,
} from "@/lib/album/capture";
import { addToAlbum } from "@/lib/album/upload";
import { posterFromVideo } from "@/lib/album/poster";
import { baseMimeType } from "@/lib/photo/keepsake";

/**
 * The daily snap.
 *
 * One round button doing two things, the way every camera people already use
 * behaves: tap for a photograph, hold for a note. That gesture is learned, so
 * it does not have to be taught — the only label is a line under the button,
 * and it goes away once you have used it.
 */

type Stage =
  | { state: "opening" }
  | { state: "denied"; message: string }
  | { state: "live" }
  | { state: "recording"; startedAt: number }
  | { state: "sending" }
  | { state: "sent" }
  | { state: "failed"; message: string };

export function SnapCamera() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const noteRef = useRef<NoteRecording | null>(null);
  const pressedAt = useRef<number>(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [facing, setFacing] = useState<Facing>("user");
  const [stage, setStage] = useState<Stage>({ state: "opening" });
  const [elapsed, setElapsed] = useState(0);

  // One camera per facing. Reopening on every render would flash the preview
  // and, on some phones, take a second or two to come back.
  useEffect(() => {
    let cancelled = false;

    openCamera(facing, true)
      .then((stream) => {
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current !== null) videoRef.current.srcObject = stream;
        setStage({ state: "live" });
      })
      .catch(() => {
        if (!cancelled) {
          setStage({
            state: "denied",
            message:
              "FestiBooth needs the camera to take a snap. Allow it in your browser's site settings, then come back.",
          });
        }
      });

    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [facing]);

  // Release the camera the moment this leaves the screen. A page that keeps a
  // phone's camera light on after you have navigated away is alarming, and
  // rightly so.
  useEffect(
    () => () => {
      stopCamera(streamRef.current);
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      if (capTimer.current !== null) clearTimeout(capTimer.current);
    },
    [],
  );

  const send = useCallback(
    async (blob: Blob, kind: "photo" | "video", mimeType: string) => {
      setStage({ state: "sending" });
      const contentType = baseMimeType(mimeType) ?? (kind === "video" ? "video/mp4" : "image/jpeg");
      const poster = kind === "video" ? await posterFromVideo(blob) : null;
      const result = await addToAlbum(blob, { kind, contentType, poster });

      if (!result.ok) {
        setStage({ state: "failed", message: result.error ?? "That did not send." });
        return;
      }
      setStage({ state: "sent" });
      // Straight to the reel, where it now sits at the front. Staying on a
      // camera that has just fired is a dead end; the album is the thing the
      // snap was for.
      setTimeout(() => router.push("/album"), 700);
    },
    [router],
  );

  /** Ends the note, whether the finger let go or the cap ran out. */
  const finish = useCallback(async () => {
    if (capTimer.current !== null) {
      clearTimeout(capTimer.current);
      capTimer.current = null;
    }
    const note = noteRef.current;
    noteRef.current = null;
    if (note === null) return;
    const recorded = await note.stop();
    if (recorded === null) {
      setStage({ state: "live" });
      return;
    }
    await send(recorded.blob, "video", recorded.mimeType);
  }, [send]);

  const beginNote = useCallback(() => {
    const stream = streamRef.current;
    if (stream === null) return;
    const note = startNote(stream);
    // A browser that cannot record leaves hold doing nothing, which is the
    // honest outcome: tap still works and is most of the feature.
    if (note === null) return;
    noteRef.current = note;
    setElapsed(0);
    setStage({ state: "recording", startedAt: Date.now() });
    // The cap matters more than it looks. A finger that slides off, a call
    // arriving, a pocket -- any of those would otherwise record until the
    // phone filled up.
    capTimer.current = setTimeout(() => void finish(), MAX_NOTE_MS);
  }, [finish]);

  const onPressDown = useCallback(() => {
    if (stage.state !== "live") return;
    pressedAt.current = Date.now();
    holdTimer.current = setTimeout(beginNote, HOLD_THRESHOLD_MS);
  }, [beginNote, stage.state]);

  const onPressUp = useCallback(async () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }

    // Recording started, so this release ends the note however brief it was.
    if (noteRef.current !== null) {
      await finish();
      return;
    }

    if (stage.state !== "live") return;
    const video = videoRef.current;
    if (video === null) return;
    const photo = await takePhoto(video, { mirror: facing === "user" });
    if (photo === null) {
      setStage({ state: "failed", message: "The camera gave nothing back. Try again." });
      return;
    }
    await send(photo, "photo", "image/jpeg");
  }, [facing, finish, send, stage.state]);

  // The ring filling while a note records. A plain interval rather than rAF:
  // it moves ten times a second and nobody is inspecting it closely. The clock
  // is read inside the callback, never while rendering -- Date.now() during a
  // render is exactly the kind of thing that updates when it feels like it.
  const recording = stage.state === "recording";
  const startedAt = stage.state === "recording" ? stage.startedAt : null;
  useEffect(() => {
    if (startedAt === null) return;
    const tick = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(tick);
  }, [startedAt]);

  const progress = recording ? Math.min(1, elapsed / MAX_NOTE_MS) : 0;

  if (stage.state === "denied") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--letterbox)] px-6 text-center">
        <p className="max-w-xs font-sans text-sm leading-relaxed text-[var(--cream)]">
          {stage.message}
        </p>
        <button
          type="button"
          onClick={() => router.push("/album")}
          className="font-sans text-xs tracking-wide text-[var(--lamp)] underline decoration-[var(--lamp)]/40 underline-offset-4"
        >
          Back to the album
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh flex-col bg-black">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
      />

      {/* Controls sit on the picture here, unlike everywhere else in the app.
          A camera has nowhere else to put them: the preview IS the screen. */}
      <div className="relative z-10 flex items-start justify-between px-5 pt-5">
        <button
          type="button"
          onClick={() => router.push("/album")}
          className="rounded-full bg-black/45 px-3 py-1.5 font-sans text-xs tracking-wide text-[var(--cream)] backdrop-blur"
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => {
            setStage({ state: "opening" });
            setFacing((f) => (f === "user" ? "environment" : "user"));
          }}
          disabled={recording}
          aria-label="Switch camera"
          className="rounded-full bg-black/45 px-3 py-1.5 font-sans text-xs tracking-wide text-[var(--cream)] backdrop-blur disabled:opacity-40"
        >
          Flip
        </button>
      </div>

      <div className="relative z-10 mt-auto flex flex-col items-center gap-3 pb-10">
        {stage.state === "sending" || stage.state === "sent" ? (
          <p className="rounded-full bg-black/50 px-4 py-1.5 font-sans text-xs tracking-wide text-[var(--cream)] backdrop-blur">
            {stage.state === "sent" ? "Sent." : "Sending…"}
          </p>
        ) : stage.state === "failed" ? (
          <p className="max-w-xs rounded-full bg-black/60 px-4 py-1.5 text-center font-sans text-xs text-[var(--neon)] backdrop-blur">
            {stage.message}
          </p>
        ) : (
          <p className="font-sans text-[11px] tracking-wide text-white/70">
            {recording ? "Let go to send" : "Tap for a photo · hold for a video"}
          </p>
        )}

        <button
          type="button"
          aria-label={recording ? "Release to send the video note" : "Tap for a photo, hold for a video note"}
          disabled={stage.state === "opening" || stage.state === "sending"}
          onPointerDown={onPressDown}
          onPointerUp={() => void onPressUp()}
          // A pointer that leaves the button still ends the note. Without this
          // a finger sliding off mid-hold records forever.
          onPointerLeave={() => {
            if (noteRef.current !== null) void onPressUp();
          }}
          onContextMenu={(event) => event.preventDefault()}
          className="relative h-20 w-20 touch-none select-none rounded-full disabled:opacity-50"
        >
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
            {recording ? (
              <circle
                cx="50" cy="50" r="45" fill="none"
                stroke="var(--dress)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${progress * 283} 283`}
              />
            ) : null}
          </svg>
          <span
            aria-hidden
            className={
              recording
                ? "absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-[6px] bg-[var(--neon)] transition-all"
                : "absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-all"
            }
          />
        </button>
      </div>
    </div>
  );
}
