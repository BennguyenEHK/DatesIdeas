import {
  FilesetResolver,
  ImageSegmenter,
  type MPMask,
} from "@mediapipe/tasks-vision";
import type { Frame } from "./capture";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export interface Segmenter {
  cutOut(frame: Frame): Frame;
}

let segmenterPromise: Promise<Segmenter | null> | null = null;

function closeMasks(masks: readonly MPMask[] | undefined): void {
  for (const mask of masks ?? []) {
    try {
      mask.close();
    } catch {
      // Releasing a failed result must not turn a usable photograph into an error.
    }
  }
}

function createSegmenter(segmenter: ImageSegmenter): Segmenter {
  return {
    cutOut(frame) {
      try {
        const result = segmenter.segment(frame.canvas);
        const masks = result.confidenceMasks;
        const personMask = masks?.[1];

        if (personMask === undefined) return frame;

        try {
          const confidence = personMask.getAsFloat32Array();
          if (confidence.length !== frame.width * frame.height) return frame;

          const canvas = document.createElement("canvas");
          canvas.width = frame.width;
          canvas.height = frame.height;
          const context = canvas.getContext("2d");
          if (context === null) return frame;

          context.drawImage(frame.canvas, 0, 0);
          const image = context.getImageData(0, 0, frame.width, frame.height);

          for (let pixel = 0; pixel < confidence.length; pixel += 1) {
            const alpha = pixel * 4 + 3;
            const maskValue = Math.max(0, Math.min(1, confidence[pixel]));
            image.data[alpha] = Math.round(image.data[alpha] * maskValue);
          }

          context.putImageData(image, 0, 0);
          return { canvas, width: frame.width, height: frame.height };
        } finally {
          // Results from the synchronous API own Wasm-backed masks until released.
          closeMasks(masks);
        }
      } catch {
        // A cut-out is optional decoration, while the captured photograph is not.
        return frame;
      }
    },
  };
}

async function create(): Promise<Segmenter | null> {
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    // GPU keeps the post-shutter wait short; CPU covers unsupported browser drivers.
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const nativeSegmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: "IMAGE",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        return createSegmenter(nativeSegmenter);
      } catch {
        // The next delegate can still work when the preferred graphics path does not.
      }
    }
  } catch {
    // Loading is best effort because the booth remains useful without a cut-out.
  }
  return null;
}

/**
 * This intentionally stays on the main thread: it runs only a handful of times
 * after the shutter, so moving image data to a worker costs more than blocking,
 * and there is no live frame that must be kept up with.
 */
export async function loadSegmenter(): Promise<Segmenter | null> {
  try {
    segmenterPromise ??= create();
    return await segmenterPromise;
  } catch {
    return null;
  }
}

export async function cutOutOrOriginal(frame: Frame): Promise<Frame> {
  try {
    const segmenter = await loadSegmenter();
    return segmenter?.cutOut(frame) ?? frame;
  } catch {
    return frame;
  }
}
