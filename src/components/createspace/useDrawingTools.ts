"use client";

import { useCallback, useState } from "react";
import {
  MIN_WIDTH,
  type CanvasOp,
  type Glyph,
  type Scene,
  type Sticker,
  type Tool,
} from "@/lib/createspace/ops";

export function useDrawingTools({
  scene,
  identity,
  sharedNow,
  onOp,
}: {
  scene: Scene;
  identity: string;
  sharedNow: () => number;
  onOp: (op: CanvasOp) => void;
}) {
  const [ink, setInk] = useState("#f5efe0");
  const [tool, setTool] = useState<Tool>("pencil");
  const [width, setWidth] = useState(MIN_WIDTH * 5);
  const [glyph, setGlyph] = useState<Glyph | null>(null);
  const [stickerScale, setStickerScale] = useState(1);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);

  const selectSticker = useCallback(
    (id: string | null) => {
      setSelectedStickerId(id);
      if (id === null) return;
      const selected = scene.items.find(
        (item): item is { type: "sticker" } & Sticker =>
          item.type === "sticker" && item.id === id && item.author === identity,
      );
      if (selected !== undefined) setStickerScale(selected.scale);
    },
    [identity, scene.items],
  );

  const changeStickerScale = useCallback(
    (scale: number) => {
      setStickerScale(scale);
      if (selectedStickerId === null) return;
      const selected = scene.items.find(
        (item): item is { type: "sticker" } & Sticker =>
          item.type === "sticker" && item.id === selectedStickerId && item.author === identity,
      );
      if (selected === undefined) return;
      onOp({
        kind: "sticker",
        sticker: { ...selected, scale, at: sharedNow() },
      });
    },
    [identity, onOp, scene.items, selectedStickerId, sharedNow],
  );

  return {
    ink,
    setInk,
    tool,
    setTool,
    width,
    setWidth,
    glyph,
    setGlyph,
    stickerScale,
    changeStickerScale,
    selectedStickerId,
    selectSticker,
  };
}
