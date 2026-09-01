/// <reference lib="webworker" />
import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { FingerStates, HandSummary, VisionFrame } from "./types";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let face: FaceLandmarker | null = null;
let hands: HandLandmarker | null = null;
let lastTimestamp = -1;

async function init() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  // GPU is preferred; some drivers reject it inside a worker, so fall back.
  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      hands = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate },
        runningMode: "VIDEO",
        numHands: 2,
      });
      return;
    } catch {
      face = null;
      hands = null;
    }
  }
  throw new Error("MediaPipe failed to initialize on both GPU and CPU");
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A finger is extended when its tip sits farther from the wrist than its PIP joint. */
function extended(
  lm: NormalizedLandmark[],
  tip: number,
  pip: number,
): boolean {
  return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.15;
}

function summarize(
  lm: NormalizedLandmark[],
  handedness: "Left" | "Right",
): HandSummary {
  const states: FingerStates = {
    thumb: extended(lm, 4, 3),
    index: extended(lm, 8, 6),
    middle: extended(lm, 12, 10),
    ring: extended(lm, 16, 14),
    pinky: extended(lm, 20, 18),
  };
  return {
    handedness,
    extended: states,
    thumbTip: { x: lm[4].x, y: lm[4].y },
    indexTip: { x: lm[8].x, y: lm[8].y },
    wrist: { x: lm[0].x, y: lm[0].y },
    scale: dist(lm[0], lm[9]) || 0.0001,
  };
}

/** One lookup pass; the categories array is ~52 entries and read five times. */
function blendshapeMap(
  categories: { categoryName: string; score: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of categories) out.set(c.categoryName, c.score);
  return out;
}

const score = (m: Map<string, number>, name: string) => m.get(name) ?? 0;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "init") {
    try {
      await init();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }

  if (msg.type !== "frame") return;
  const bitmap = msg.bitmap as ImageBitmap;

  try {
    // Always answer, even when there is nothing to say. The client releases its
    // in-flight slot on this reply; staying silent latches the pump shut.
    if (!face || !hands) {
      self.postMessage({ type: "idle" });
      return;
    }
    // detectForVideo rejects non-increasing timestamps.
    const ts = msg.timestamp <= lastTimestamp ? lastTimestamp + 1 : msg.timestamp;
    lastTimestamp = ts;

    const faceResult = face.detectForVideo(bitmap, ts);
    const handResult = hands.detectForVideo(bitmap, ts);

    const shapes = faceResult.faceBlendshapes?.[0]
      ? blendshapeMap(faceResult.faceBlendshapes[0].categories)
      : new Map<string, number>();

    // Landmarks 13 and 14 are the inner centres of the upper and lower lip;
    // their midpoint is the mouth, and it stays put whether it is open or shut.
    const lm = faceResult.faceLandmarks?.[0];
    const upper = lm?.[13];
    const lower = lm?.[14];
    const mouth =
      upper && lower
        ? { x: (upper.x + lower.x) / 2, y: (upper.y + lower.y) / 2 }
        : null;

    const frame: VisionFrame = {
      timestamp: ts,
      smileScore: Math.max(
        score(shapes, "mouthSmileLeft"),
        score(shapes, "mouthSmileRight"),
      ),
      puckerScore: score(shapes, "mouthPucker"),
      blinkLeft: score(shapes, "eyeBlinkLeft"),
      blinkRight: score(shapes, "eyeBlinkRight"),
      mouth,
      hands: handResult.landmarks.map((lm, i) =>
        summarize(
          lm,
          (handResult.handedness[i]?.[0]?.categoryName as "Left" | "Right") ?? "Right",
        ),
      ),
    };
    self.postMessage({ type: "frame", frame });
  } catch {
    // A single bad frame must not end the session, but it must not be
    // mistaken for a frame still in flight either.
    self.postMessage({ type: "idle" });
  } finally {
    // Always release: a leaked ImageBitmap at 30fps exhausts GPU memory fast.
    bitmap.close();
  }
};
