"use client";

import { useCallback, useEffect, useState } from "react";
import { addToAlbum } from "@/lib/album/upload";
import type { AlbumItem } from "@/lib/album/types";
import { fitContain, paintScene } from "@/lib/createspace/render";
import { PicturePicker } from "../PicturePicker";
import type { CreateSpaceProps } from "../CreateSpace";
import { ArtworkCanvas } from "./ArtworkCanvas";
import { useDrawingTools } from "./useDrawingTools";
import { useWorkshopShortcuts } from "./useWorkshopShortcuts";
import { ActionBar } from "./tray/ActionBar";
import { ColorBar } from "./tray/ColorBar";
import { StickerBar } from "./tray/StickerBar";
import { ToolBar } from "./tray/ToolBar";
import styles from "./CreateSpace.module.css";

type Preview = { id: string; url: string; aspect: number | null };

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
      if (blob === null) reject(new Error("The picture could not be prepared."));
      else resolve(blob);
    }, "image/png");
  });
}

export function DoodleWorkshop(props: CreateSpaceProps) {
  const tools = useDrawingTools(props);
  const [pendingBase, setPendingBase] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [leaveArmed, setLeaveArmed] = useState(false);
  useWorkshopShortcuts(props.undo, props.redo);

  useEffect(() => {
    if (props.baseItemId === null) return;
    let active = true;
    void findAlbumItem(props.baseItemId)
      .then((item) => {
        if (active && item !== null) setPreview({ id: item.id, url: item.url, aspect: null });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [props.baseItemId]);

  const leave = (): void => {
    if (props.scene.items.length === 0 || leaveArmed) {
      props.onSession({ workshop: "menu" });
      setLeaveArmed(false);
      return;
    }
    setLeaveArmed(true);
  };

  const confirmBase = (): void => {
    if (pendingBase === undefined) return;
    props.onBase(pendingBase);
    props.onOp({ kind: "clear" });
    setPendingBase(undefined);
  };

  const save = useCallback(async () => {
    setSaveStatus("Preparing the picture…");
    let objectUrl: string | null = null;
    try {
      let image: HTMLImageElement | null = null;
      if (props.baseItemId !== null) {
        const item = await findAlbumItem(props.baseItemId);
        if (item === null) throw new Error("That album picture is not available on this device.");
        const response = await fetch(item.url);
        if (!response.ok) throw new Error("The album picture could not be fetched.");
        objectUrl = URL.createObjectURL(await response.blob());
        image = await loadImage(objectUrl);
      }

      const sourceWidth = image?.naturalWidth ?? 1800;
      const sourceHeight = image?.naturalHeight ?? 1200;
      const outputScale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight));
      const output = document.createElement("canvas");
      output.width = Math.round(sourceWidth * outputScale);
      output.height = Math.round(sourceHeight * outputScale);
      const context = output.getContext("2d");
      if (context === null) throw new Error("This browser cannot prepare the picture.");

      if (image === null) {
        context.fillStyle = "#f5efe0";
        context.fillRect(0, 0, output.width, output.height);
      } else {
        const bounds = fitContain(image.naturalWidth, image.naturalHeight, output.width, output.height);
        context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
      }
      paintScene(context, props.scene, output.width, output.height);

      setSaveStatus("Keeping it in the album…");
      const result = await addToAlbum(await canvasBlob(output), {
        kind: "strip",
        contentType: "image/png",
        sourceRoom: props.room,
      });
      setSaveStatus(result.ok ? "Kept. It is on the reel now." : (result.error ?? "Could not save."));
    } catch (error: unknown) {
      setSaveStatus(error instanceof Error ? error.message : "Could not save.");
    } finally {
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    }
  }, [props.baseItemId, props.room, props.scene]);

  const hasPreview = props.baseItemId !== null && preview?.id === props.baseItemId;
  const aspect = hasPreview ? (preview.aspect ?? 1.5) : 1.5;

  return (
    <section className={styles.workshop}>
      <header className={styles.workshopHeader}>
        <button type="button" className={styles.backButton} onClick={leave}>
          {leaveArmed ? "Leave drawing?" : "← Workshops"}
        </button>
        <div>
          <p className={styles.eyebrow}>Shared picture canvas</p>
          <h1>Draw together</h1>
        </div>
      </header>

      <main className={styles.table}>
        <div className={styles.artworkWrap}>
          <ArtworkCanvas
            aspect={aspect}
            imageUrl={hasPreview ? preview.url : null}
            imageAlt="The selected album picture"
            scene={props.scene}
            identity={props.identity}
            sharedNow={props.sharedNow}
            tool={tools.tool}
            ink={tools.ink}
            width={tools.width}
            glyph={tools.glyph}
            stickerScale={tools.stickerScale}
            selectedStickerId={tools.selectedStickerId}
            onSelectedSticker={tools.selectSticker}
            onOp={props.onOp}
            onImageLoad={(image) => {
              if (image.naturalWidth === 0 || image.naturalHeight === 0) return;
              setPreview((current) =>
                current === null ? current : { ...current, aspect: image.naturalWidth / image.naturalHeight },
              );
            }}
          />
        </div>
      </main>

      <div className={styles.tray}>
        <div className={styles.trayBar} aria-label="Picture">
          <span className={styles.trayLabel}>Picture</span>
          <PicturePicker
            value={props.baseItemId}
            onPick={(id) => {
              if (id !== props.baseItemId) setPendingBase(id);
            }}
          />
        </div>
        <ColorBar
          colour={tools.ink}
          paper="#f5efe0"
          target="ink"
          allowPaper={false}
          onTarget={() => undefined}
          onColour={tools.setInk}
        />
        <ToolBar tool={tools.tool} width={tools.width} onTool={tools.setTool} onWidth={tools.setWidth} />
        <StickerBar
          glyph={tools.glyph}
          scale={tools.stickerScale}
          selected={tools.selectedStickerId !== null}
          onGlyph={tools.setGlyph}
          onScale={tools.changeStickerScale}
        />
        <ActionBar
          canUndo={props.canUndo}
          canRedo={props.canRedo}
          onUndo={props.undo}
          onRedo={props.redo}
          onClear={() => props.onOp({ kind: "clear" })}
          onSave={() => void save()}
          saveLabel="Keep in the album"
        />
        {pendingBase !== undefined && (
          <div className={styles.inlineConfirm} role="group" aria-label="Change picture">
            <p>Use this picture and clear the drawing for both of you?</p>
            <button type="button" className={styles.confirmButton} onClick={confirmBase}>
              Use picture
            </button>
            <button type="button" onClick={() => setPendingBase(undefined)}>
              Keep drawing
            </button>
          </div>
        )}
        {saveStatus !== null && (
          <p role="status" className={styles.status}>
            {saveStatus}
          </p>
        )}
      </div>
    </section>
  );
}
