import { starsFor, type Theme } from "./themes";
import type { Panel, Rect, StripLayout } from "./strip";

export interface Shot {
  /** Null when that person's camera gave nothing at the moment of the flash. */
  left: CanvasImageSource | null;
  right: CanvasImageSource | null;
}

function fillRect(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function paintPeople(
  ctx: CanvasRenderingContext2D,
  panel: Panel,
  shot: Shot | undefined,
): void {
  if (shot?.left !== null && shot?.left !== undefined) {
    ctx.drawImage(
      shot.left,
      panel.left.x,
      panel.left.y,
      panel.left.width,
      panel.left.height,
    );
  }

  if (shot?.right !== null && shot?.right !== undefined) {
    ctx.drawImage(
      shot.right,
      panel.right.x,
      panel.right.y,
      panel.right.width,
      panel.right.height,
    );
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
 * The light laid over the people: the grade, then the vignette.
 *
 * The grade is what makes two people in two different rooms look like they are
 * in one photograph — the same light falling on both faces. Without it a strip
 * is two webcam grabs pasted onto a nice background, and reads as exactly that.
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

export function paintStrip(
  ctx: CanvasRenderingContext2D,
  layout: StripLayout,
  t: Theme,
  shots: Shot[],
  caption: string,
): void {
  const filter = sceneFilter(t);

  paintScene(ctx, t, layout);

  ctx.save();
  ctx.filter = filter;
  layout.panels.forEach((panel, index) => paintPeople(ctx, panel, shots[index]));
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
