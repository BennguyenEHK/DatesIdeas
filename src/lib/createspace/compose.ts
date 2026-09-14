import { paintScene as paintNightScene } from "@/lib/photo/paint";
import { STRIP_WIDTH, stripLayout, type Rect, type ShotCount } from "@/lib/photo/strip";
import { theme } from "@/lib/photo/themes";
import { paintScene } from "./render";
import type { Scene } from "./ops";

export { STRIP_WIDTH };

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

function browserCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function blobFor(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** The cover-size source, centred on the chosen fractional point in a panel. */
export function placeBackdrop(
  panel: Rect,
  imageWidth: number,
  imageHeight: number,
  placement: { x: number; y: number; scale: number },
): Rect {
  const scale = Math.max(panel.width / imageWidth, panel.height / imageHeight) * placement.scale;
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: panel.x + placement.x * panel.width - width / 2,
    y: panel.y + placement.y * panel.height - height / 2,
    width,
    height,
  };
}

export function stripAspect(shots: ShotCount): number {
  const layout = stripLayout(shots);
  return layout.width / layout.height;
}

/** Marks live on their own transparent layer, so erasers never cut the photograph beneath. */
export function renderMarks(
  scene: Scene,
  width: number,
  height: number,
  factory: CanvasFactory = browserCanvas,
): HTMLCanvasElement | null {
  const canvas = factory(width, height);
  if (canvas === null) return null;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  paintScene(ctx, scene, width, height);
  return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load strip."));
    image.src = url;
  });
}

export async function composeOverStrip(stripUrl: string, scene: Scene): Promise<Blob | null> {
  try {
    const strip = await loadImage(stripUrl);
    const canvas = browserCanvas(strip.naturalWidth, strip.naturalHeight);
    if (canvas === null) return null;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    ctx.drawImage(strip, 0, 0);
    const marks = renderMarks(scene, canvas.width, canvas.height);
    if (marks === null) return null;
    ctx.drawImage(marks, 0, 0);
    return await blobFor(canvas);
  } catch {
    return null;
  }
}

export async function renderLookLayers({
  shots,
  paper,
  backdrop,
  scene,
  width = STRIP_WIDTH,
  factory = browserCanvas,
}: {
  shots: ShotCount;
  paper: string;
  backdrop: {
    image: CanvasImageSource;
    width: number;
    height: number;
    x: number;
    y: number;
    scale: number;
  } | null;
  scene: Scene;
  width?: number;
  factory?: CanvasFactory;
}): Promise<{ backdrop: Blob; overlay: Blob } | null> {
  const layout = stripLayout(shots, width);
  const base = factory(layout.width, layout.height);
  if (base === null) return null;
  const ctx = base.getContext("2d");
  const overlay = renderMarks(scene, layout.width, layout.height, factory);
  if (ctx === null || overlay === null) return null;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const panel of layout.panels) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(panel.x, panel.y, panel.width, panel.height);
    ctx.clip();
    if (backdrop === null) {
      ctx.save();
      ctx.translate(panel.x, panel.y);
      paintNightScene(ctx, theme("griffith"), { width: panel.width, height: panel.height });
      ctx.restore();
    } else {
      const dest = placeBackdrop(panel, backdrop.width, backdrop.height, backdrop);
      ctx.drawImage(backdrop.image, dest.x, dest.y, dest.width, dest.height);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = layout.width * 0.012;
    ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);
    ctx.restore();
  }
  const [backdropBlob, overlayBlob] = await Promise.all([blobFor(base), blobFor(overlay)]);
  return backdropBlob === null || overlayBlob === null
    ? null
    : { backdrop: backdropBlob, overlay: overlayBlob };
}
