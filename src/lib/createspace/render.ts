import type { Scene, Stroke } from "./ops";

export type CanvasPainter = Pick<
  CanvasRenderingContext2D,
  | "arc"
  | "beginPath"
  | "fill"
  | "fillStyle"
  | "globalAlpha"
  | "globalCompositeOperation"
  | "fillText"
  | "font"
  | "lineCap"
  | "lineJoin"
  | "lineTo"
  | "lineWidth"
  | "moveTo"
  | "restore"
  | "rotate"
  | "save"
  | "stroke"
  | "strokeStyle"
  | "shadowBlur"
  | "shadowColor"
  | "textAlign"
  | "textBaseline"
  | "translate"
>;

export function fitContain(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return {
    x: (boxW - width) / 2,
    y: (boxH - height) / 2,
    width,
    height,
  };
}

export function paintScene(
  ctx: CanvasPainter,
  scene: Scene,
  width: number,
  height: number,
): void {
  // This is a transparent marks layer. Erasers remove marks only, never a
  // photograph or paper layer drawn below it.
  for (const item of scene.items) {
    if (item.type === "stroke") {
      ctx.save();
      paintStroke(ctx, item, width, height);
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.translate(item.x * width, item.y * height);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.font = `${Math.max(16, width * 0.08 * item.scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.glyph, 0, 0);
    ctx.restore();
  }
}

function pathLength(stroke: Stroke, width: number, height: number): number {
  return stroke.points.slice(1).reduce((total, point, index) => {
    const previous = stroke.points[index];
    return total + Math.hypot((point[0] - previous[0]) * width, (point[1] - previous[1]) * height);
  }, 0);
}

/** A tiny deterministic generator makes spray identical on every peer. */
function randomFor(id: string): () => number {
  let value = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    value = Math.imul(value ^ id.charCodeAt(index), 16777619);
  }
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function paintSpray(ctx: CanvasPainter, stroke: Stroke, width: number, height: number): void {
  const random = randomFor(stroke.id);
  const radius = ctx.lineWidth / 2;
  const count = Math.max(1, Math.round(pathLength(stroke, width, height) / Math.max(1, radius * 0.35)));
  for (let index = 0; index < count; index += 1) {
    const segment = Math.min(stroke.points.length - 2, Math.floor(random() * Math.max(1, stroke.points.length - 1)));
    const first = stroke.points[segment] ?? stroke.points[0];
    const last = stroke.points[segment + 1] ?? first;
    const along = random();
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    ctx.beginPath();
    ctx.arc(
      (first[0] + (last[0] - first[0]) * along) * width + Math.cos(angle) * distance,
      (first[1] + (last[1] - first[1]) * along) * height + Math.sin(angle) * distance,
      Math.max(1, radius * (0.08 + random() * 0.12)),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function paintStroke(ctx: CanvasPainter, stroke: Stroke, width: number, height: number): void {
  const [first, ...rest] = stroke.points;
  if (first === undefined) return;
  const tool = stroke.tool ?? "pencil";
  ctx.strokeStyle = stroke.ink;
  ctx.fillStyle = stroke.ink;
  ctx.lineWidth = stroke.width * width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (tool === "eraser") ctx.globalCompositeOperation = "destination-out";
  if (tool === "brush") {
    ctx.shadowBlur = ctx.lineWidth * 0.6;
    ctx.shadowColor = stroke.ink;
    ctx.globalAlpha = 0.9;
  }
  if (tool === "spray") {
    paintSpray(ctx, stroke, width, height);
    return;
  }
  ctx.beginPath();
  if (rest.length === 0) {
    ctx.arc(first[0] * width, first[1] * height, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(first[0] * width, first[1] * height);
  for (const point of rest) ctx.lineTo(point[0] * width, point[1] * height);
  ctx.stroke();
}
