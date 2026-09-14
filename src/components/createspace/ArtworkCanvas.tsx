"use client";

import type { CanvasOp, Glyph, Scene, Tool } from "@/lib/createspace/ops";
import { MarksLayer } from "./MarksLayer";
import styles from "./CreateSpace.module.css";

export function ArtworkCanvas({
  aspect,
  imageUrl,
  imageAlt,
  canvasLabel = "Shared drawing canvas",
  scene,
  identity,
  sharedNow,
  tool,
  ink,
  width,
  glyph,
  stickerScale,
  selectedStickerId,
  onImageLoad,
  onSelectedSticker,
  onOp,
}: {
  aspect: number;
  imageUrl: string | null;
  imageAlt: string;
  canvasLabel?: string;
  scene: Scene;
  identity: string;
  sharedNow: () => number;
  tool: Tool;
  ink: string;
  width: number;
  glyph: Glyph | null;
  stickerScale: number;
  selectedStickerId: string | null;
  onImageLoad?: (image: HTMLImageElement) => void;
  onSelectedSticker: (id: string | null) => void;
  onOp: (op: CanvasOp) => void;
}) {
  return (
    <div className={styles.artwork} style={{ aspectRatio: aspect }}>
      {imageUrl !== null && (
        /* Blob and signed album URLs do not have stable dimensions for next/image. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imageUrl}
          alt={imageAlt}
          className={styles.artworkImage}
          onLoad={(event) => onImageLoad?.(event.currentTarget)}
        />
      )}
      <MarksLayer
        ariaLabel={canvasLabel}
        scene={scene}
        identity={identity}
        sharedNow={sharedNow}
        tool={tool}
        ink={ink}
        width={width}
        glyph={glyph}
        stickerScale={stickerScale}
        selectedStickerId={selectedStickerId}
        onSelectedSticker={onSelectedSticker}
        onOp={onOp}
      />
    </div>
  );
}
