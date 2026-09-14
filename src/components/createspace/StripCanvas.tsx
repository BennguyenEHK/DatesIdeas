"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { placeBackdrop } from "@/lib/createspace/compose";
import type { CanvasOp, Glyph, Scene, Tool } from "@/lib/createspace/ops";
import type { Backdrop } from "@/lib/createspace/session";
import { paintScene as paintNight } from "@/lib/photo/paint";
import { stripLayout, type ShotCount } from "@/lib/photo/strip";
import { theme } from "@/lib/photo/themes";
import { MarksLayer } from "./MarksLayer";
import { MergeVideo } from "./MergeVideo";
import styles from "./CreateSpace.module.css";

export type StripCanvasProps = {
  scene: Scene;
  shots: ShotCount;
  paper: string;
  backdrop: Backdrop | null;
  image: HTMLImageElement | null;
  merge: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  identity: string;
  sharedNow: () => number;
  tool: Tool;
  ink: string;
  width: number;
  glyph: Glyph | null;
  stickerScale: number;
  selectedStickerId: string | null;
  backdropEditing: boolean;
  onSelectedSticker: (id: string | null) => void;
  onOp: (op: CanvasOp) => void;
  onBackdrop: (patch: Pick<Backdrop, "x" | "y" | "scale">) => void;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function pointerFraction(event: React.PointerEvent<HTMLCanvasElement>): readonly [number, number] {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return [0.5, 0.5];
  return [
    clamp((event.clientX - rect.left) / rect.width, 0, 1),
    clamp((event.clientY - rect.top) / rect.height, 0, 1),
  ];
}

function StripBaseLayer({
  shots,
  paper,
  backdrop,
  image,
}: Pick<StripCanvasProps, "shots" | "paper" | "backdrop" | "image">) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const paint = useCallback(() => {
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
    context.fillStyle = paper;
    context.fillRect(0, 0, rect.width, rect.height);

    const layout = stripLayout(shots);
    const scale = rect.width / layout.width;
    for (const panel of layout.panels) {
      context.save();
      context.beginPath();
      context.rect(panel.x * scale, panel.y * scale, panel.width * scale, panel.height * scale);
      context.clip();
      if (image !== null && backdrop !== null) {
        const destination = placeBackdrop(panel, image.naturalWidth, image.naturalHeight, backdrop);
        context.drawImage(
          image,
          destination.x * scale,
          destination.y * scale,
          destination.width * scale,
          destination.height * scale,
        );
      } else {
        context.save();
        context.translate(panel.x * scale, panel.y * scale);
        paintNight(context, theme("griffith"), {
          width: panel.width * scale,
          height: panel.height * scale,
        });
        context.restore();
      }
      context.restore();
      context.strokeStyle = "#ffffff";
      context.lineWidth = Math.max(2, rect.width * 0.012);
      context.strokeRect(panel.x * scale, panel.y * scale, panel.width * scale, panel.height * scale);
    }
  }, [backdrop, image, paper, shots]);

  useEffect(() => {
    paint();
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  return <canvas ref={canvasRef} aria-hidden className={styles.baseLayer} />;
}

function PhotoWindows({ shots }: { shots: ShotCount }) {
  const layout = stripLayout(shots);
  return (
    <div className={styles.photoWindows} aria-label={`${shots} photo windows`}>
      {layout.panels.map((panel, index) => (
        <div
          key={index}
          aria-label={`Photo window ${index + 1}`}
          style={{
            left: `${(panel.x / layout.width) * 100}%`,
            top: `${(panel.y / layout.height) * 100}%`,
            width: `${(panel.width / layout.width) * 100}%`,
            height: `${(panel.height / layout.height) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

export function StripCanvas(props: StripCanvasProps) {
  const layout = stripLayout(props.shots);
  const lastBackdropUpdate = useRef(0);
  const mergePanels = useMemo(
    () =>
      stripLayout(props.shots).panels.map((panel) => ({
        x: panel.x / layout.width,
        y: panel.y / layout.height,
        width: panel.width / layout.width,
        height: panel.height / layout.height,
      })),
    [layout.height, layout.width, props.shots],
  );

  const backdropPointer =
    props.backdropEditing && props.backdrop !== null
      ? {
          onDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
            const [x, y] = pointerFraction(event);
            props.onBackdrop({ x, y, scale: props.backdrop?.scale ?? 1 });
          },
          onMove: (event: React.PointerEvent<HTMLCanvasElement>) => {
            const now = performance.now();
            if (now - lastBackdropUpdate.current < 66) return;
            lastBackdropUpdate.current = now;
            const [x, y] = pointerFraction(event);
            props.onBackdrop({ x, y, scale: props.backdrop?.scale ?? 1 });
          },
          onUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
            const [x, y] = pointerFraction(event);
            props.onBackdrop({ x, y, scale: props.backdrop?.scale ?? 1 });
          },
          onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => {
            event.preventDefault();
            props.onBackdrop({
              x: props.backdrop?.x ?? 0.5,
              y: props.backdrop?.y ?? 0.5,
              scale: clamp((props.backdrop?.scale ?? 1) + (event.deltaY < 0 ? 0.1 : -0.1), 0.5, 4),
            });
          },
        }
      : undefined;

  return (
    <div className={styles.strip} style={{ aspectRatio: layout.width / layout.height }}>
      <StripBaseLayer shots={props.shots} paper={props.paper} backdrop={props.backdrop} image={props.image} />
      {props.merge && (
        <div className={styles.mergeLayer}>
          <MergeVideo
            localStream={props.localStream}
            remoteStream={props.remoteStream}
            hasBackdrop={props.backdrop !== null}
            panels={mergePanels}
          />
        </div>
      )}
      <PhotoWindows shots={props.shots} />
      <MarksLayer
        ariaLabel="Photo strip drawing canvas"
        scene={props.scene}
        identity={props.identity}
        sharedNow={props.sharedNow}
        tool={props.tool}
        ink={props.ink}
        width={props.width}
        glyph={props.glyph}
        stickerScale={props.stickerScale}
        selectedStickerId={props.selectedStickerId}
        onSelectedSticker={props.onSelectedSticker}
        onOp={props.onOp}
        backdropPointer={backdropPointer}
      />
    </div>
  );
}
