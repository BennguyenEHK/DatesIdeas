"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  MAX_POINTS,
  mirrorScene,
  newItemId,
  thin,
  type CanvasOp,
  type Glyph,
  type Point,
  type Scene,
  type Sticker,
  type Tool,
} from "@/lib/createspace/ops";
import { paintScene } from "@/lib/createspace/render";
import styles from "./CreateSpace.module.css";

type BackdropPointer = {
  onDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => void;
};

export type MarksLayerProps = {
  ariaLabel: string;
  scene: Scene;
  identity: string;
  sharedNow: () => number;
  tool: Tool;
  ink: string;
  width: number;
  glyph: Glyph | null;
  stickerScale: number;
  selectedStickerId: string | null;
  onSelectedSticker: (id: string | null) => void;
  onOp: (op: CanvasOp) => void;
  backdropPointer?: BackdropPointer;
  /**
   * This screen sees the strip flipped left-to-right relative to the shared
   * frame the marks are kept in, so draw them flipped and read the pointer
   * flipped. The ops sent out stay in the shared frame.
   */
  mirrored?: boolean;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>, mirrored: boolean): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return [0, 0];
  const x = clamp((event.clientX - rect.left) / rect.width);
  return [mirrored ? 1 - x : x, clamp((event.clientY - rect.top) / rect.height)];
}

function findSticker(scene: Scene, identity: string, point: Point): Sticker | "locked" | null {
  for (let index = scene.items.length - 1; index >= 0; index -= 1) {
    const item = scene.items[index];
    if (item.type !== "sticker") continue;
    if (Math.hypot(item.x - point[0], item.y - point[1]) > item.scale * 0.08) continue;
    return item.author === identity ? item : "locked";
  }
  return null;
}

function paintSelection(
  context: CanvasRenderingContext2D,
  scene: Scene,
  selectedStickerId: string | null,
  width: number,
  height: number,
): void {
  if (selectedStickerId === null) return;
  const sticker = scene.items.find(
    (item): item is { type: "sticker" } & Sticker => item.type === "sticker" && item.id === selectedStickerId,
  );
  if (sticker === undefined) return;

  const radius = Math.max(14, width * 0.052 * sticker.scale);
  context.save();
  context.strokeStyle = "rgba(245, 239, 224, 0.82)";
  context.lineWidth = Math.max(1.5, width * 0.003);
  context.setLineDash([Math.max(3, width * 0.008), Math.max(3, width * 0.006)]);
  context.beginPath();
  context.arc(sticker.x * width, sticker.y * height, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

export function MarksLayer({
  ariaLabel,
  scene,
  identity,
  sharedNow,
  tool,
  ink,
  width,
  glyph,
  stickerScale,
  selectedStickerId,
  onSelectedSticker,
  onOp,
  backdropPointer,
  mirrored = false,
}: MarksLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const draggedStickerRef = useRef<Sticker | null>(null);
  const shown = useMemo(() => (mirrored ? mirrorScene(scene) : scene), [mirrored, scene]);

  const redraw = useCallback(
    (draft: readonly Point[] = []) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas === null || context === null || context === undefined) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(rect.width * ratio);
      const pixelHeight = Math.round(rect.height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      paintScene(context, shown, rect.width, rect.height);
      if (draft.length > 0) {
        const draftScene: Scene = {
          items: [
            {
              type: "stroke",
              id: "draft",
              author: identity,
              at: 0,
              ink,
              tool,
              width,
              points: draft,
            },
          ],
        };
        paintScene(context, mirrored ? mirrorScene(draftScene) : draftScene, rect.width, rect.height);
      }
      paintSelection(context, shown, selectedStickerId, rect.width, rect.height);
    },
    [identity, ink, mirrored, shown, selectedStickerId, tool, width],
  );

  useEffect(() => {
    redraw(pointsRef.current);
  }, [redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => redraw(pointsRef.current));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  const commitStroke = useCallback(
    (keepLastPoint: boolean) => {
      const points = thin(pointsRef.current).slice(0, MAX_POINTS);
      if (points.length === 0) return;
      onOp({
        kind: "stroke",
        stroke: {
          id: newItemId(),
          author: identity,
          at: sharedNow(),
          ink,
          tool,
          width,
          points,
        },
      });
      pointsRef.current = keepLastPoint ? [points[points.length - 1]] : [];
    },
    [identity, ink, onOp, sharedNow, tool, width],
  );

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (backdropPointer !== undefined) {
      backdropPointer.onUp(event);
    } else if (pointsRef.current.length > 0) {
      commitStroke(false);
    }
    draggedStickerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    redraw();
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label={ariaLabel}
      className={styles.marksLayer}
      onWheel={backdropPointer?.onWheel}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        if (backdropPointer !== undefined) {
          backdropPointer.onDown(event);
          return;
        }

        const point = pointFromEvent(event, mirrored);
        const sticker = findSticker(scene, identity, point);
        if (sticker === "locked") return;
        if (sticker !== null) {
          draggedStickerRef.current = sticker;
          onSelectedSticker(sticker.id);
          return;
        }
        if (glyph !== null) {
          const id = newItemId();
          onOp({
            kind: "sticker",
            sticker: {
              id,
              author: identity,
              at: sharedNow(),
              glyph,
              x: point[0],
              y: point[1],
              scale: stickerScale,
              rotation: 0,
            },
          });
          onSelectedSticker(id);
          return;
        }

        onSelectedSticker(null);
        pointsRef.current = [point];
        redraw(pointsRef.current);
      }}
      onPointerMove={(event) => {
        if (backdropPointer !== undefined) {
          backdropPointer.onMove(event);
          return;
        }

        const point = pointFromEvent(event, mirrored);
        if (draggedStickerRef.current !== null) {
          onOp({
            kind: "sticker",
            sticker: {
              ...draggedStickerRef.current,
              x: point[0],
              y: point[1],
              at: sharedNow(),
            },
          });
          return;
        }
        if (pointsRef.current.length === 0) return;
        pointsRef.current = [...pointsRef.current, point];
        if (pointsRef.current.length >= 40) commitStroke(true);
        redraw(pointsRef.current);
      }}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    />
  );
}
