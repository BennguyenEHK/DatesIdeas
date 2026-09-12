import type { Scene } from "./ops";

export type CanvasPainter = Pick<
  CanvasRenderingContext2D,
  | "arc"
  | "beginPath"
  | "fill"
  | "fillStyle"
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
  for (const item of scene.items) {
    if (item.type === "stroke") {
      const [first, ...rest] = item.points;
      if (first === undefined) continue;

      ctx.strokeStyle = item.ink;
      ctx.fillStyle = item.ink;
      ctx.lineWidth = item.width * width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();

      if (rest.length === 0) {
        ctx.arc(first[0] * width, first[1] * height, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.moveTo(first[0] * width, first[1] * height);
      for (const point of rest) ctx.lineTo(point[0] * width, point[1] * height);
      ctx.stroke();
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
