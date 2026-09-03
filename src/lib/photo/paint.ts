import { starsFor, type Theme } from "./themes";
import {
  PANEL_ASPECT,
  STRIP_WIDTH,
  type Panel,
  type Rect,
  type StripLayout,
} from "./strip";

/** The portrait falloff at the standard export width. */
export const PERSON_BLUR_PX = 18;
/** Enough room detail to join the scene without competing with the person. */
export const PERSON_BLUR_ALPHA = 0.55;

export interface Shot {
  /** Null when that person's camera gave nothing at the moment of the flash. */
  left: CanvasImageSource | null;
  right: CanvasImageSource | null;
}

function fillRect(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

type PaintContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function intrinsicSize(source: CanvasImageSource): { width: number; height: number } | null {
  const candidate = source as CanvasImageSource & {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  };
  const width = candidate.videoWidth ?? candidate.naturalWidth ?? candidate.width;
  const height = candidate.videoHeight ?? candidate.naturalHeight ?? candidate.height;
  return width && height && width > 0 && height > 0 ? { width, height } : null;
}

function drawCropped(ctx: PaintContext, image: CanvasImageSource, dest: Rect): void {
  const source = intrinsicSize(image);
  if (!source) {
    ctx.drawImage(image, dest.x, dest.y, dest.width, dest.height);
    return;
  }

  const sourceAspect = source.width / source.height;
  const destinationAspect = dest.width / dest.height;
  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;
  if (sourceAspect > destinationAspect) {
    sw = sh * destinationAspect;
    sx = (source.width - sw) / 2;
  } else {
    sh = sw / destinationAspect;
    sy = (source.height - sh) / 2;
  }
  ctx.drawImage(image, sx, sy, sw, sh, dest.x, dest.y, dest.width, dest.height);
}

function offscreenCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Feathering the two halves into the scene prevents their shared edge reading as a splice. */
function paintPerson(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  dest: Rect,
  blurRadius: number,
): void {
  if ("filter" in ctx) {
    ctx.save();
    ctx.filter = `blur(${blurRadius}px)`;
    ctx.globalAlpha = PERSON_BLUR_ALPHA;
    drawCropped(ctx, image, dest);
    ctx.restore();
  }

  const canvas = offscreenCanvas(dest.width, dest.height);
  const mask = canvas?.getContext("2d") as PaintContext | null;
  if (!canvas || !mask) {
    drawCropped(ctx, image, dest);
    return;
  }

  drawCropped(mask, image, { x: 0, y: 0, width: dest.width, height: dest.height });
  mask.save();
  mask.globalCompositeOperation = "destination-in";
  mask.translate(dest.width * 0.5, dest.height * 0.46);
  mask.scale(dest.width * 0.68, dest.height * 0.82);
  const feather = mask.createRadialGradient(0, 0, 0, 0, 0, 1);
  feather.addColorStop(0.58, "#000");
  feather.addColorStop(1, "rgba(0,0,0,0)");
  mask.fillStyle = feather;
  mask.fillRect(-1, -1, 2, 2);
  mask.restore();
  ctx.drawImage(canvas, dest.x, dest.y, dest.width, dest.height);
}

function paintPeople(
  ctx: CanvasRenderingContext2D,
  panel: Panel,
  shot: Shot | undefined,
  blurRadius: number,
): void {
  if (shot?.left !== null && shot?.left !== undefined) {
    paintPerson(ctx, shot.left, panel.left, blurRadius);
  }

  if (shot?.right !== null && shot?.right !== undefined) {
    paintPerson(ctx, shot.right, panel.right, blurRadius);
  }
}

function sceneFilter(t: Theme): string {
  return t.desaturate > 0 ? `grayscale(${t.desaturate})` : "none";
}

/**
 * Paints the saved strip from the same theme data as the live preview.
 *
 * A canvas cannot draw its already-painted contents back through a filter on
 * the same context without a separate source canvas, so the scene layers are
 * filtered as they are drawn. The frame and caption stay crisp and readable.
 */
/**
 * The scene behind everything: sky, its light sources, and its stars.
 *
 * Split out from paintStrip so the live preview can call it too. There was a
 * version of this design with a second painter in CSS mirroring these rules,
 * and it would have drifted the first time anyone edited one and not the
 * other. One painter, used twice, cannot drift at all.
 *
 * `box` is where the scene is drawn; positions in a theme are fractions of it,
 * so the same theme fills a tall strip and a wide stage equally.
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  t: Theme,
  box: { width: number; height: number },
): void {
  const filter = sceneFilter(t);

  ctx.save();
  ctx.filter = filter;
  const sky = ctx.createLinearGradient(0, 0, 0, box.height);
  for (const stop of t.sky) sky.addColorStop(stop.at, stop.color);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, box.width, box.height);
  ctx.restore();

  ctx.save();
  ctx.filter = filter;
  for (const glow of t.glows) {
    const x = glow.x * box.width;
    const y = glow.y * box.height;
    const radius = glow.radius * box.width;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, glow.color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, box.width, box.height);
  }
  ctx.restore();

  ctx.save();
  ctx.filter = filter;
  ctx.fillStyle = t.ink;
  for (const star of starsFor(t)) {
    ctx.globalAlpha = star.alpha;
    ctx.beginPath();
    ctx.arc(
      star.x * box.width,
      star.y * box.height,
      star.radius * box.width,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The light laid over the people: the grade, then a restrained corner vignette.
 *
 * The grade is what makes two people in two different rooms look like they are
 * in one photograph — the same light falling on both faces. Without it a strip
 * is two webcam grabs pasted onto a nice background, and reads as exactly that.
 * The vignette only steadies the outermost corners; anything stronger muddies
 * the two faces that sit in its path.
 *
 * It covers `graded` only, never the whole box, so a caption band underneath
 * keeps its own ink colour instead of being tinted along with the pictures.
 */
export function paintFinish(
  ctx: CanvasRenderingContext2D,
  t: Theme,
  box: { width: number; height: number },
  graded: readonly Rect[],
): void {
  if (t.grade !== null) {
    ctx.save();
    ctx.globalCompositeOperation = t.grade.mode;
    ctx.globalAlpha = t.grade.alpha;
    ctx.fillStyle = t.grade.color;
    for (const rect of graded) fillRect(ctx, rect);
    ctx.restore();
  }

  ctx.save();
  ctx.filter = sceneFilter(t);
  const centreX = box.width / 2;
  const centreY = box.height / 2;
  const radius = Math.hypot(centreX, centreY);
  const vignette = ctx.createRadialGradient(centreX, centreY, 0, centreX, centreY, radius);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, `rgba(0,0,0,${t.vignette})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, box.width, box.height);
  ctx.restore();
}

/** How wide the preview held up after each flash is painted. */
export const PREVIEW_WIDTH = 960;

/**
 * One photograph on its own: the scene, both of you side by side, the grade
 * over the pair.
 *
 * This exists because the preview shown after each flash used to be the LOCAL
 * capture alone, stretched across the frame — so each person's preview held up
 * only themselves, and the two of you never appeared together until the strip
 * finally developed. It was a picture of one camera pretending to be a
 * photograph of two people.
 *
 * Painted by the same functions as the strip and the live stage, in the same
 * 16:9 shape a panel has, so what is held up is a true miniature of what the
 * strip will contain rather than a differently-cropped rehearsal.
 */
export function paintShot(
  ctx: CanvasRenderingContext2D,
  t: Theme,
  shot: Shot | undefined,
  box: { width: number; height: number },
): void {
  const blurRadius = Math.max(1, Math.round(PERSON_BLUR_PX * (box.width / STRIP_WIDTH)));
  const half = box.width / 2;
  const panel: Panel = {
    x: 0,
    y: 0,
    width: box.width,
    height: box.height,
    left: { x: 0, y: 0, width: half, height: box.height },
    right: { x: half, y: 0, width: half, height: box.height },
  };

  paintScene(ctx, t, box);

  ctx.save();
  ctx.filter = sceneFilter(t);
  paintPeople(ctx, panel, shot, blurRadius);
  ctx.restore();

  paintFinish(ctx, t, box, [{ x: 0, y: 0, width: box.width, height: box.height }]);
}

/**
 * Paints one shot onto a fresh canvas, or returns null when there is nothing
 * of either of you to show.
 *
 * Deliberately NOT cut out. Segmentation costs about a tenth of a second per
 * image and the preview appears on the same instant as the flash — but more
 * than that, seeing yourselves lifted out of your own rooms is what the strip
 * developing IS. Cutting the preview out would spend the surprise early.
 */
export function shotPreview(
  t: Theme,
  shot: Shot,
  width = PREVIEW_WIDTH,
): HTMLCanvasElement | null {
  if (shot.left === null && shot.right === null) return null;
  if (typeof document === "undefined") return null;

  const height = Math.round(width / PANEL_ASPECT);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;

  paintShot(ctx, t, shot, { width, height });
  return canvas;
}

export function paintStrip(
  ctx: CanvasRenderingContext2D,
  layout: StripLayout,
  t: Theme,
  shots: Shot[],
  caption: string,
): void {
  const filter = sceneFilter(t);
  const blurRadius = Math.max(1, Math.round(PERSON_BLUR_PX * (layout.width / STRIP_WIDTH)));

  paintScene(ctx, t, layout);

  ctx.save();
  ctx.filter = filter;
  layout.panels.forEach((panel, index) => paintPeople(ctx, panel, shots[index], blurRadius));
  ctx.restore();

  paintFinish(ctx, t, layout, layout.panels);

  ctx.save();
  ctx.strokeStyle = t.frame;
  ctx.lineWidth = Math.max(1, layout.width * 0.008);
  const inset = ctx.lineWidth / 2;
  ctx.strokeRect(inset, inset, layout.width - ctx.lineWidth, layout.height - ctx.lineWidth);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = t.ink;
  ctx.font = `${Math.max(1, layout.caption.height * 0.48)}px "Poiret One", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    caption,
    layout.caption.x + layout.caption.width / 2,
    layout.caption.y + layout.caption.height / 2,
  );
  ctx.restore();
}
