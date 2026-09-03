/** Frames a second. Enough for motion, cheap enough to run beside a camera. */
export const CLIP_FPS = 24;

/**
 * Candidate container/codec strings, best first.
 *
 * MP4 leads, and it is chosen for where the file ENDS UP rather than for where
 * it is made. A live photo exists to be scanned onto a phone — and an iPhone
 * cannot save WebM to Photos at all, while Android puts it somewhere a gallery
 * often will not look. H.264 in MP4 is the one video format every phone will
 * simply keep.
 *
 * WebM stays behind it as the fallback, because a browser that cannot record
 * MP4 can always record WebM, and a live photo that plays on a laptop is worth
 * more than none at all.
 */
export const CLIP_MIME_TYPES: readonly string[] = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/** A phone's Photos/Gallery, not the recording browser, determines what can be kept. */
export function phoneCanKeep(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && /^video\/mp4(?:;codecs=.*)?$/i.test(mimeType);
}

/**
 * A minimal stand-in for MediaRecorder's static support check, so this
 * module can be tested without a real one.
 */
export interface RecorderSupport {
  isTypeSupported(type: string): boolean;
}

/** The first supported type, or null when none of them are. */
export function pickMimeType(support?: RecorderSupport | null): string | null {
  const available = support === undefined ? globalRecorderSupport() : support;
  if (available === null) return null;

  for (const type of CLIP_MIME_TYPES) {
    try {
      if (available.isTypeSupported(type)) return type;
    } catch {
      // A broken support check should only disable the optional live photo.
      return null;
    }
  }

  return null;
}

export interface Clip {
  blob: Blob;
  mimeType: string;
  /** Milliseconds actually recorded, measured, not requested. */
  durationMs: number;
}

/** A recording in progress. */
export interface Recording {
  /** Resolves the finished clip, or null when nothing usable was produced. */
  stop(): Promise<Clip | null>;
  /** Abandons the recording and releases everything. Safe to call twice. */
  cancel(): void;
}

/** The narrowest shape of a canvas this module needs, for testability. */
export interface RecordableCanvas {
  captureStream(frameRate?: number): MediaStream;
}

interface Recorder extends RecorderSupport {
  state: string;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: (() => void) | null;
  start(): void;
  stop(): void;
}

interface RecorderConstructor extends RecorderSupport {
  new (stream: MediaStream, options: MediaRecorderOptions): Recorder;
}

function globalRecorderSupport(): RecorderSupport | null {
  const candidate = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  if (
    candidate === null ||
    typeof candidate !== "function" ||
    !("isTypeSupported" in candidate) ||
    typeof candidate.isTypeSupported !== "function"
  ) {
    return null;
  }

  return candidate as RecorderSupport;
}

function globalRecorderConstructor(): RecorderConstructor | null {
  const support = globalRecorderSupport();
  if (support === null) return null;

  return (globalThis as { MediaRecorder?: unknown }).MediaRecorder as RecorderConstructor;
}

function stopTracks(stream: MediaStream): void {
  try {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Releasing the remaining tracks still lets the canvas settle down.
      }
    }
  } catch {
    // Some partial browser implementations cannot enumerate their tracks.
  }
}

function recordingFps(fps: number | undefined): number {
  return typeof fps === "number" && Number.isFinite(fps) && fps > 0 ? fps : CLIP_FPS;
}

/**
 * Starts filming a canvas. Returns null when the browser cannot record,
 * which callers must treat as "no live photo" rather than as an error.
 */
export function startRecording(
  canvas: RecordableCanvas | null,
  options?: { fps?: number; mimeType?: string | null; now?: () => number },
): Recording | null {
  if (canvas === null || typeof canvas.captureStream !== "function") return null;

  const constructor = globalRecorderConstructor();
  if (constructor === null) return null;

  const requestedType = options?.mimeType;
  const mimeType =
    typeof requestedType === "string"
      ? supportsType(constructor, requestedType)
        ? requestedType
        : null
      : pickMimeType(constructor);
  if (mimeType === null) return null;

  let stream: MediaStream | null = null;
  let recorder: Recorder;
  try {
    stream = canvas.captureStream(recordingFps(options?.fps));
    recorder = new constructor(stream, { mimeType });
    recorder.start();
  } catch {
    if (stream !== null) stopTracks(stream);
    return null;
  }
  if (stream === null) return null;

  const now = options?.now ?? Date.now;
  const startedAt = safeNow(now);
  const chunks: Blob[] = [];
  let cancelled = false;
  let tracksStopped = false;
  let stopPromise: Promise<Clip | null> | null = null;
  let resolveStop: ((clip: Clip | null) => void) | null = null;
  let settled = false;

  const releaseTracks = (): void => {
    if (tracksStopped) return;
    tracksStopped = true;
    stopTracks(stream);
  };

  const finish = (): void => {
    if (settled || resolveStop === null) return;
    settled = true;
    releaseTracks();

    let clip: Clip | null = null;
    if (!cancelled && chunks.length > 0) {
      try {
        clip = {
          blob: new Blob(chunks, { type: mimeType }),
          mimeType,
          durationMs: Math.max(0, Math.round(safeNow(now) - startedAt)),
        };
      } catch {
        // A failed encode should not interrupt the still-photo session.
      }
    }
    resolveStop(clip);
  };

  recorder.ondataavailable = (event) => {
    if (!cancelled && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = finish;

  return {
    stop(): Promise<Clip | null> {
      if (stopPromise !== null) return stopPromise;

      stopPromise = new Promise((resolve) => {
        resolveStop = resolve;
      });

      if (cancelled || recorder.state === "inactive") {
        finish();
      } else {
        try {
          recorder.stop();
        } catch {
          finish();
        }
      }

      return stopPromise;
    },
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      chunks.length = 0;

      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The tracks below are the important resource to release here.
        }
      }
      releaseTracks();
      if (resolveStop !== null) finish();
    },
  };
}

function supportsType(support: RecorderSupport, type: string): boolean {
  try {
    return support.isTypeSupported(type);
  } catch {
    return false;
  }
}

function safeNow(now: () => number): number {
  try {
    const value = now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Rough size of a clip, for deciding whether it is worth uploading. */
export function clipSizeMb(clip: Clip | null): number {
  if (clip === null) return 0;
  return Math.round((clip.blob.size / (1024 * 1024)) * 10) / 10;
}
