"use client";

import { pickMimeType } from "@/lib/photo/record";

/**
 * Taking a snap: one tap for a photograph, one hold for a video note.
 *
 * The camera work is here rather than in the component so the component is
 * only ever deciding what to show. It deliberately reuses `pickMimeType` from
 * the photo booth -- the reasoning about MP4 versus WebM is already written
 * down there, and a second copy would drift.
 */

/** Below this, a press is a tap. Above it, the person meant to hold. */
export const HOLD_THRESHOLD_MS = 320;

/** A note, not a film. Long enough to say something, short enough to send. */
export const MAX_NOTE_MS = 30_000;

/** The longest edge of a still, in pixels. A phone photo is far larger than
 *  anything the reel or a notification will ever show. */
export const SNAP_MAX_EDGE = 1600;
export const SNAP_QUALITY = 0.82;

export type Facing = "user" | "environment";

export async function openCamera(facing: Facing, withAudio: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
    // Audio is requested only when it might be recorded. Asking for the
    // microphone to take a silent photograph is a permission prompt that
    // earns nothing and costs trust.
    audio: withAudio,
  });
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // A track that is already gone is the outcome we wanted anyway.
    }
  });
}

/**
 * A still from the live preview.
 *
 * Drawn from the video element rather than taken with ImageCapture: the
 * element is what the person was actually looking at, and ImageCapture is
 * unevenly supported and silently absent on several Android browsers.
 */
export async function takePhoto(
  video: HTMLVideoElement,
  options?: { mirror?: boolean; document?: Document },
): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) return null;

  const scale = Math.min(1, SNAP_MAX_EDGE / Math.max(width, height));
  const canvas = (options?.document ?? document).createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (context === null) return null;

  if (options?.mirror === true) {
    // The front camera preview is mirrored, because that is what a mirror
    // does and anything else feels wrong to the person looking at it. The
    // saved photograph has to match what they saw, or every snap comes out
    // subtly, unaccountably reversed.
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", SNAP_QUALITY);
  });
}

export interface NoteRecording {
  /** Resolves the finished note, or null if nothing usable was captured. */
  stop(): Promise<{ blob: Blob; mimeType: string } | null>;
}

/**
 * Starts recording a video note from a live stream.
 *
 * Returns null when this browser cannot record at all, which the caller should
 * treat as "hold does nothing here" rather than as a failure to report: tap
 * still works, and a camera that can photograph is most of the feature.
 */
export function startNote(stream: MediaStream): NoteRecording | null {
  const mimeType = pickMimeType();
  if (mimeType === null) return null;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    return null;
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  return {
    stop() {
      return new Promise((resolve) => {
        if (recorder.state === "inactive") {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          resolve(blob.size > 0 ? { blob, mimeType } : null);
        };
        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
      });
    },
  };
}
