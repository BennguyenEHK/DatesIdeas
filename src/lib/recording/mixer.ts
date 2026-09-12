"use client";

import { pickMimeType } from "@/lib/photo/record";
import {
  RECORDING_FPS,
  RECORDING_HEIGHT,
  RECORDING_WIDTH,
  coverCrop,
  pairLayout,
} from "./layout";

/**
 * Turning a call into one recordable stream.
 *
 * Two video elements and two audio sources have to become a single track each,
 * because MediaRecorder records a stream, not a room. The video is composited
 * onto a canvas that is repainted every frame; the audio is summed through a
 * Web Audio graph.
 *
 * What this cannot do is record a film. A YouTube activity is a cross-origin
 * iframe, and a canvas is not permitted to read one — so a recording made
 * during movie night gets the two of you and the sound of the room, and not the
 * picture. That is a browser security rule and there is no way around it short
 * of asking for a screen share every time.
 */

export interface Mixed {
  stream: MediaStream;
  /** Releases the canvas, the painting loop and the audio graph. */
  stop(): void;
}

export interface MixSources {
  /**
   * The elements already on screen, when the caller has them. Null is fine and
   * common: the room only hands its video elements to the photo booth, so in an
   * ordinary call these arrive empty and the mixer films the streams itself.
   */
  localVideo: HTMLVideoElement | null;
  remoteVideo: HTMLVideoElement | null;
  /** For audio. The video elements' own sound is playing through speakers and
   *  cannot be tapped without taking it off them. */
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

/**
 * A hidden video element playing a stream, for when nobody handed us one.
 *
 * This is what stops an ordinary call from recording as two black rectangles
 * with sound. The elements on screen live inside VideoTile and are not exposed
 * to the room; rather than plumb refs through every stage, the mixer plays each
 * stream into an element of its own. Muted, because the audio is already being
 * summed separately and a second copy would double it.
 */
function ownVideo(stream: MediaStream | null): HTMLVideoElement | null {
  if (stream === null || stream.getVideoTracks().length === 0) return null;
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => {
      // Autoplay is allowed for a muted element; if it is refused anyway the
      // tile paints the room colour rather than failing the recording.
    });
    return video;
  } catch {
    return null;
  }
}

function releaseVideo(video: HTMLVideoElement | null): void {
  if (video === null) return;
  try {
    video.pause();
    video.srcObject = null;
  } catch {
    // Already released.
  }
}

function drawTile(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  box: { x: number; y: number; width: number; height: number },
): void {
  context.fillStyle = "#080b1c";
  context.fillRect(box.x, box.y, box.width, box.height);

  // HAVE_CURRENT_DATA. Drawing a video with nothing decoded yet throws in some
  // browsers and paints a frame of noise in others.
  if (video === null || video.readyState < 2) return;
  if (video.videoWidth === 0 || video.videoHeight === 0) return;

  const crop = coverCrop(video.videoWidth, video.videoHeight, box.width, box.height);
  try {
    context.drawImage(
      video,
      crop.x, crop.y, crop.width, crop.height,
      box.x, box.y, box.width, box.height,
    );
  } catch {
    // A frame that will not draw is one missing frame, not a failed recording.
  }
}

/**
 * Sums whatever audio there is into one track.
 *
 * Returns null when there is nothing to sum, so a recording of a call with both
 * microphones off is silent rather than failed.
 */
function mixAudio(
  context: AudioContext,
  streams: readonly (MediaStream | null)[],
): MediaStreamAudioDestinationNode | null {
  const destination = context.createMediaStreamDestination();
  let connected = 0;

  for (const stream of streams) {
    if (stream === null || stream.getAudioTracks().length === 0) continue;
    try {
      context.createMediaStreamSource(stream).connect(destination);
      connected += 1;
    } catch {
      // One source refusing to connect must not take the other down with it.
    }
  }

  return connected === 0 ? null : destination;
}

/**
 * Builds the combined stream. Returns null when this browser cannot record.
 */
export function mixCall(sources: MixSources): Mixed | null {
  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement("canvas");
    canvas.width = RECORDING_WIDTH;
    canvas.height = RECORDING_HEIGHT;
    context = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (context === null) return null;

  // Only elements this mixer made are its to release; ones on screen belong to
  // the room and stopping them would black out the call.
  const ownedLocal = sources.localVideo === null ? ownVideo(sources.localStream) : null;
  const ownedRemote = sources.remoteVideo === null ? ownVideo(sources.remoteStream) : null;
  const localElement = sources.localVideo ?? ownedLocal;
  const remoteElement = sources.remoteVideo ?? ownedRemote;

  const both = remoteElement !== null;
  const boxes = pairLayout(RECORDING_WIDTH, RECORDING_HEIGHT, both ? 2 : 1);

  let frame = 0;
  const paint = () => {
    // The ground is painted first, so the gutter between the tiles is the
    // room's own colour rather than whatever was in the buffer before.
    context.fillStyle = "#080b1c";
    context.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);
    drawTile(context, localElement, boxes[0]);
    if (both) drawTile(context, remoteElement, boxes[1]);
    frame = requestAnimationFrame(paint);
  };
  frame = requestAnimationFrame(paint);

  const video = canvas.captureStream(RECORDING_FPS);

  let audioContext: AudioContext | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  try {
    audioContext = new AudioContext();
    destination = mixAudio(audioContext, [sources.localStream, sources.remoteStream]);
  } catch {
    // No audio is a worse recording, not a failed one.
  }

  const stream = new MediaStream([
    ...video.getVideoTracks(),
    ...(destination === null ? [] : destination.stream.getAudioTracks()),
  ]);

  return {
    stream,
    stop() {
      cancelAnimationFrame(frame);
      releaseVideo(ownedLocal);
      releaseVideo(ownedRemote);
      video.getTracks().forEach((track) => track.stop());
      stream.getTracks().forEach((track) => track.stop());
      // Closing the context releases the sources; leaving it open keeps an
      // audio graph alive for the rest of the evening for no reason.
      void audioContext?.close().catch(() => {});
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export interface CallRecording {
  /** Resolves the finished recording, or null when nothing usable came out. */
  stop(): Promise<{ blob: Blob; mimeType: string; durationMs: number } | null>;
  /** Abandons it and releases everything. Safe to call twice. */
  cancel(): void;
}

/**
 * Starts recording a call. Null when this browser cannot.
 *
 * Deliberately mirrors `startRecording` in the photo booth rather than sharing
 * it: that one films a canvas and has no audio at all, and folding two
 * different jobs into one function would make both harder to read.
 */
export function startCallRecording(sources: MixSources): CallRecording | null {
  const mimeType = pickMimeType();
  if (mimeType === null) return null;

  const mixed = mixCall(sources);
  if (mixed === null) return null;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(mixed.stream, { mimeType });
  } catch {
    mixed.stop();
    return null;
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const startedAt = Date.now();
  recorder.start(1000);

  let done = false;

  return {
    stop() {
      return new Promise((resolve) => {
        if (done || recorder.state === "inactive") {
          resolve(null);
          return;
        }
        done = true;
        recorder.onstop = () => {
          mixed.stop();
          const blob = new Blob(chunks, { type: mimeType });
          resolve(
            blob.size > 0
              ? // Measured, not requested: what was actually captured.
                { blob, mimeType, durationMs: Date.now() - startedAt }
              : null,
          );
        };
        try {
          recorder.stop();
        } catch {
          mixed.stop();
          resolve(null);
        }
      });
    },
    cancel() {
      if (done) return;
      done = true;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // Already stopping. The release below is the part that matters.
      }
      mixed.stop();
    },
  };
}
