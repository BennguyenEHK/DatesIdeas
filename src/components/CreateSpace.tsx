"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addToAlbum } from "@/lib/album/upload";
import type { AlbumItem } from "@/lib/album/types";
import {
  INKS,
  MAX_POINTS,
  MAX_SCALE,
  MAX_WIDTH,
  MIN_SCALE,
  MIN_WIDTH,
  STICKERS,
  newItemId,
  thin,
  undoTarget,
  type CanvasOp,
  type Glyph,
  type Point,
  type Scene,
  type Sticker,
} from "@/lib/createspace/ops";
import { fitContain, paintScene } from "@/lib/createspace/render";
import { PicturePicker } from "./PicturePicker";

type CreateSpaceProps = {
  identity: string;
  scene: Scene;
  baseItemId: string | null;
  room: string;
  sharedNow: () => number;
  onOp: (op: CanvasOp) => void;
  onBase: (itemId: string | null) => void;
};

type Preview = { id: string; url: string; aspect: number | null };
type DraggingSticker = { sticker: Sticker };

const WIDTHS = [MIN_WIDTH, (MIN_WIDTH + MAX_WIDTH) / 2, MAX_WIDTH] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isAlbumItems(value: unknown): value is AlbumItem[] {
  return Array.isArray(value);
}

async function findAlbumItem(id: string): Promise<AlbumItem | null> {
  const response = await fetch("/api/album", { credentials: "same-origin" });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!isAlbumItems(body)) return null;
  return body.find((item) => item.id === id) ?? null;
}

function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
  const y = rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height;
  return [clamp(x, 0, 1), clamp(y, 0, 1)];
}

function strokePreview(points: readonly Point[], ink: (typeof INKS)[number], width: number): Scene {
  return {
    items: points.length === 0
      ? []
      : [{ type: "stroke", id: "preview", author: "preview", at: 0, ink, width, points }],
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The picture could not be opened."));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("The picture could not be prepared."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export function CreateSpace({
  identity,
  scene,
  baseItemId,
  room,
  sharedNow,
  onOp,
  onBase,
}: CreateSpaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const dragRef = useRef<DraggingSticker | null>(null);
  const [ink, setInk] = useState<(typeof INKS)[number]>(INKS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [glyph, setGlyph] = useState<Glyph | null>(null);
  const [stickerScale, setStickerScale] = useState(1);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [pendingBase, setPendingBase] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const redraw = useCallback(
    (draft: readonly Point[] = []) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas === null || context === null || context === undefined) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(rect.width * ratio);
      const pixelHeight = Math.round(rect.height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      paintScene(context, scene, rect.width, rect.height);
      if (draft.length > 0) {
        paintScene(context, strokePreview(draft, ink, width), rect.width, rect.height);
      }
    },
    [ink, scene, width],
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

  useEffect(() => {
    if (baseItemId === null) return;
    let active = true;

    void findAlbumItem(baseItemId)
      .then((item) => {
        if (active && item !== null) setPreview({ id: item.id, url: item.url, aspect: null });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [baseItemId]);

  const undo = useCallback(() => {
    const id = undoTarget(scene, identity);
    if (id !== null) onOp({ kind: "remove", id });
  }, [identity, onOp, scene]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo]);

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
          width,
          points,
        },
      });
      pointsRef.current = keepLastPoint ? [points[points.length - 1]] : [];
    },
    [identity, ink, onOp, sharedNow, width],
  );

  const ownStickerAt = useCallback(
    (point: Point): Sticker | "locked" | null => {
      for (let index = scene.items.length - 1; index >= 0; index -= 1) {
        const item = scene.items[index];
        if (item.type !== "sticker") continue;
        const distance = Math.hypot(item.x - point[0], item.y - point[1]);
        if (distance <= 0.08 * item.scale) return item.author === identity ? item : "locked";
      }
      return null;
    },
    [identity, scene.items],
  );

  const changeStickerScale = useCallback(
    (change: number) => {
      const nextScale = clamp(stickerScale + change, MIN_SCALE, MAX_SCALE);
      setStickerScale(nextScale);
      if (selectedStickerId === null) return;
      const sticker = scene.items.find(
        (item): item is { type: "sticker" } & Sticker =>
          item.type === "sticker" && item.id === selectedStickerId && item.author === identity,
      );
      if (sticker === undefined) return;
      onOp({
        kind: "sticker",
        sticker: { ...sticker, scale: nextScale, at: sharedNow() },
      });
    },
    [identity, onOp, scene.items, selectedStickerId, sharedNow, stickerScale],
  );

  const chooseBase = useCallback(
    (id: string | null) => {
      if (id === baseItemId) return;
      setPendingBase(id);
    },
    [baseItemId],
  );

  const confirmBase = useCallback(() => {
    if (pendingBase === undefined) return;
    onBase(pendingBase);
    onOp({ kind: "clear" });
    setPendingBase(undefined);
  }, [onBase, onOp, pendingBase]);

  const save = useCallback(async () => {
    setSaveStatus("Preparing the picture…");
    let objectUrl: string | null = null;

    try {
      let image: HTMLImageElement | null = null;
      if (baseItemId !== null) {
        const item = await findAlbumItem(baseItemId);
        if (item === null) throw new Error("That album picture is not available on this device.");
        const response = await fetch(item.url);
        if (!response.ok) throw new Error("The album picture could not be fetched.");
        objectUrl = URL.createObjectURL(await response.blob());
        image = await loadImage(objectUrl);
      }

      const sourceWidth = image?.naturalWidth ?? 1800;
      const sourceHeight = image?.naturalHeight ?? 1200;
      const scale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight));
      const output = document.createElement("canvas");
      output.width = Math.round(sourceWidth * scale);
      output.height = Math.round(sourceHeight * scale);
      const context = output.getContext("2d");
      if (context === null) throw new Error("This browser cannot prepare the picture.");

      if (image === null) {
        context.fillStyle = "#f5efe0";
        context.fillRect(0, 0, output.width, output.height);
      } else {
        const bounds = fitContain(image.naturalWidth, image.naturalHeight, output.width, output.height);
        context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
      }
      paintScene(context, scene, output.width, output.height);

      setSaveStatus("Keeping it in the album…");
      const result = await addToAlbum(await canvasBlob(output), {
        kind: "strip",
        contentType: "image/png",
        sourceRoom: room,
      });
      setSaveStatus(result.ok ? "Kept. It is on the reel now." : (result.error ?? "Could not save."));
    } catch (error: unknown) {
      setSaveStatus(error instanceof Error ? error.message : "Could not save.");
    } finally {
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    }
  }, [baseItemId, room, scene]);

  const hasPreview = baseItemId !== null && preview?.id === baseItemId;
  const pictureAspect = hasPreview ? (preview.aspect ?? 1.5) : 1.5;
  const undoId = undoTarget(scene, identity);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--letterbox)] text-[var(--cream)]">
      <div className="min-h-0 flex-1 p-3">
        <div className="relative mx-auto flex h-full max-w-5xl items-center justify-center bg-[var(--night)]">
          <div
            className="relative max-h-full w-full overflow-hidden bg-[var(--cream)]"
            style={{ aspectRatio: pictureAspect }}
          >
            {hasPreview && (
              /* The visible image never enters the export canvas; saving fetches its bytes first. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview.url}
                alt="The selected album picture"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth === 0 || image.naturalHeight === 0) return;
                  setPreview((current) => {
                    if (current?.id !== baseItemId) return current;
                    return { ...current, aspect: image.naturalWidth / image.naturalHeight };
                  });
                }}
                className="absolute inset-0 h-full w-full object-contain"
              />
            )}
            <canvas
              ref={canvasRef}
              aria-label="Shared drawing canvas"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const point = pointFromEvent(event);
                const sticker = ownStickerAt(point);
                if (sticker === "locked") return;
                if (sticker !== null) {
                  dragRef.current = { sticker };
                  setSelectedStickerId(sticker.id);
                  return;
                }
                if (glyph !== null) {
                  onOp({
                    kind: "sticker",
                    sticker: {
                      id: newItemId(),
                      author: identity,
                      at: sharedNow(),
                      glyph,
                      x: point[0],
                      y: point[1],
                      scale: stickerScale,
                      rotation: 0,
                    },
                  });
                  return;
                }
                pointsRef.current = [point];
                redraw(pointsRef.current);
              }}
              onPointerMove={(event) => {
                const point = pointFromEvent(event);
                if (dragRef.current !== null) {
                  const { sticker } = dragRef.current;
                  onOp({
                    kind: "sticker",
                    sticker: { ...sticker, x: point[0], y: point[1], at: sharedNow() },
                  });
                  return;
                }
                if (pointsRef.current.length === 0) return;
                pointsRef.current = [...pointsRef.current, point];
                if (pointsRef.current.length >= 40) commitStroke(true);
                redraw(pointsRef.current);
              }}
              onPointerUp={(event) => {
                dragRef.current = null;
                if (pointsRef.current.length > 0) commitStroke(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                redraw();
              }}
              onPointerCancel={() => {
                dragRef.current = null;
                if (pointsRef.current.length > 0) commitStroke(false);
                redraw();
              }}
              className="absolute inset-0 h-full w-full touch-none outline-none
                focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lamp)]"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--edge)] px-3 py-2">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <PicturePicker value={baseItemId} onPick={chooseBase} />
          <div className="flex items-center gap-1" aria-label="Ink colour">
            {INKS.map((colour) => (
              <button
                key={colour}
                type="button"
                aria-label={`Ink ${colour}`}
                aria-pressed={ink === colour}
                onClick={() => setInk(colour)}
                className="h-5 w-5 rounded-full border border-[var(--cream)] outline-offset-2
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lamp)]"
                style={{ backgroundColor: colour }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1" aria-label="Line width">
            {WIDTHS.map((value, index) => (
              <button
                key={value}
                type="button"
                aria-label={`Set line width ${index + 1}`}
                aria-pressed={width === value}
                onClick={() => setWidth(value)}
                className="h-7 min-w-7 border border-[var(--edge)] px-1 text-[var(--cream)]
                  outline-offset-2 focus-visible:outline focus-visible:outline-2
                  focus-visible:outline-[var(--lamp)]"
              >
                <span style={{ fontSize: `${8 + index * 4}px` }}>●</span>
              </button>
            ))}
          </div>
          <div className="flex max-w-full items-center gap-1 overflow-x-auto" aria-label="Stickers">
            {STICKERS.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={`Sticker ${item}`}
                aria-pressed={glyph === item}
                onClick={() => setGlyph(glyph === item ? null : item)}
                className="h-7 min-w-7 border border-[var(--edge)] text-base outline-offset-2
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lamp)]"
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              aria-label="Make sticker smaller"
              onClick={() => changeStickerScale(-0.2)}
              className="h-7 border border-[var(--edge)] px-2 outline-offset-2
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lamp)]"
            >
              −
            </button>
            <button
              type="button"
              aria-label="Make sticker larger"
              onClick={() => changeStickerScale(0.2)}
              className="h-7 border border-[var(--edge)] px-2 outline-offset-2
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lamp)]"
            >
              +
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label="Undo your last mark"
              disabled={undoId === null}
              onClick={undo}
              className="border border-[var(--edge)] px-2 py-1 outline-offset-2
                hover:border-[var(--mist)] focus-visible:outline focus-visible:outline-2
                focus-visible:outline-[var(--lamp)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              aria-label="Clear drawing for both people"
              onClick={() => {
                if (clearArmed) {
                  onOp({ kind: "clear" });
                  setClearArmed(false);
                  return;
                }
                setClearArmed(true);
              }}
              className="border border-[var(--edge)] px-2 py-1 outline-offset-2
                hover:border-[var(--mist)] focus-visible:outline focus-visible:outline-2
                focus-visible:outline-[var(--lamp)]"
            >
              {clearArmed ? "Clear for both?" : "Clear"}
            </button>
            <button
              type="button"
              aria-label="Keep in the album"
              onClick={() => void save()}
              className="bg-[var(--dress)] px-3 py-1 text-[var(--night)] outline-offset-2
                hover:bg-[var(--lamp)] focus-visible:outline focus-visible:outline-2
                focus-visible:outline-[var(--cream)]"
            >
              Keep in the album
            </button>
          </div>
          {saveStatus !== null && <p className="basis-full text-[var(--mist)]">{saveStatus}</p>}
          {pendingBase !== undefined && (
            <div
              className="flex basis-full items-center gap-2 border-t border-[var(--edge)] pt-2
                text-[var(--mist)]"
            >
              <p>Use this picture and clear the drawing for both of you?</p>
              <button
                type="button"
                onClick={confirmBase}
                className="border border-[var(--lamp)] px-2 py-1 text-[var(--cream)] outline-offset-2
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lamp)]"
              >
                Use picture
              </button>
              <button
                type="button"
                onClick={() => setPendingBase(undefined)}
                className="border border-[var(--edge)] px-2 py-1 outline-offset-2
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lamp)]"
              >
                Keep drawing
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
