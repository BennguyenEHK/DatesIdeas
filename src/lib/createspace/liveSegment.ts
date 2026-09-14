import { FilesetResolver, ImageSegmenter, type MPMask } from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export interface LiveSegmenter {
  draw(
    video: HTMLVideoElement,
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    mirrored: boolean,
  ): void;
  close(): void;
}

function closeMasks(masks: readonly MPMask[] | undefined): void {
  for (const mask of masks ?? []) {
    try {
      mask.close();
    } catch {
      // Mask cleanup is best effort; the next live frame should still be attempted.
    }
  }
}

function drawCropped(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  mirrored: boolean,
): void {
  if (video.videoWidth === 0 || video.videoHeight === 0) return;
  const sourceAspect = video.videoWidth / video.videoHeight;
  const destinationAspect = width / height;
  const sourceWidth =
    sourceAspect > destinationAspect ? video.videoHeight * destinationAspect : video.videoWidth;
  const sourceHeight =
    sourceAspect > destinationAspect ? video.videoHeight : video.videoWidth / destinationAspect;
  const sourceX = (video.videoWidth - sourceWidth) / 2;
  const sourceY = (video.videoHeight - sourceHeight) / 2;

  context.save();
  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  context.restore();
}

function createLiveSegmenter(nativeSegmenter: ImageSegmenter): LiveSegmenter {
  const scratch = document.createElement("canvas");
  return {
    draw(video, context, width, height, mirrored) {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;
      scratch.width = Math.max(1, Math.round(width));
      scratch.height = Math.max(1, Math.round(height));
      const scratchContext = scratch.getContext("2d");
      if (scratchContext === null) return;
      scratchContext.clearRect(0, 0, scratch.width, scratch.height);
      drawCropped(scratchContext, video, scratch.width, scratch.height, mirrored);

      let masks: readonly MPMask[] | undefined;
      try {
        masks = nativeSegmenter.segmentForVideo(scratch, performance.now()).confidenceMasks;
        const person = masks?.[1];
        if (person === undefined) {
          drawCropped(context, video, width, height, mirrored);
          return;
        }
        const values = person.getAsFloat32Array();
        if (values.length !== scratch.width * scratch.height) {
          drawCropped(context, video, width, height, mirrored);
          return;
        }
        const image = scratchContext.getImageData(0, 0, scratch.width, scratch.height);
        for (let index = 0; index < values.length; index += 1) {
          image.data[index * 4 + 3] *= Math.max(0, Math.min(1, values[index]));
        }
        scratchContext.putImageData(image, 0, 0);
        context.drawImage(scratch, 0, 0, width, height);
      } catch {
        drawCropped(context, video, width, height, mirrored);
      } finally {
        closeMasks(masks);
      }
    },
    close() {
      nativeSegmenter.close();
    },
  };
}

/** Loads a closeable VIDEO model per preview, with raw camera fallback at the call site. */
export async function loadLiveSegmenter(): Promise<LiveSegmenter | null> {
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const nativeSegmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        return createLiveSegmenter(nativeSegmenter);
      } catch {
        // CPU keeps this optional treatment available when the graphics path fails.
      }
    }
  } catch {
    // Merge still shows both cameras when the optional model cannot load.
  }
  return null;
}
