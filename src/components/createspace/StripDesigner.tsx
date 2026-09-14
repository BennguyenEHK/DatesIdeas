"use client";

import { useCallback, useEffect, useState } from "react";
import { renderLookLayers } from "@/lib/createspace/compose";
import { BACKDROP_MAX_SCALE, BACKDROP_MIN_SCALE } from "@/lib/createspace/session";
import { looksClient } from "@/lib/looks/client";
import { loadBackdrop } from "@/lib/photo/backdrops";
import type { CreateSpaceProps } from "../CreateSpace";
import { ArtworkCanvas } from "./ArtworkCanvas";
import { StripCanvas } from "./StripCanvas";
import { useDrawingTools } from "./useDrawingTools";
import { useWorkshopShortcuts } from "./useWorkshopShortcuts";
import { ActionBar } from "./tray/ActionBar";
import { BackdropBar } from "./tray/BackdropBar";
import { ColorBar } from "./tray/ColorBar";
import { ShotsBar } from "./tray/ShotsBar";
import { StickerBar } from "./tray/StickerBar";
import { ToolBar } from "./tray/ToolBar";
import styles from "./CreateSpace.module.css";

let nextLookNumber = 1;

function nextLookName(): string {
  return `Our look ${nextLookNumber}`;
}

export function StripDesigner(props: CreateSpaceProps) {
  const edit = props.session.mode === "edit";
  const tools = useDrawingTools(props);
  const [colourTarget, setColourTarget] = useState<"ink" | "paper">("ink");
  const [backdropEditing, setBackdropEditing] = useState(false);
  const [loadedBackdrop, setLoadedBackdrop] = useState<{
    key: string;
    image: HTMLImageElement;
  } | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [name, setName] = useState(nextLookName);
  const [status, setStatus] = useState<string | null>(null);
  const [backArmed, setBackArmed] = useState(false);
  const [editAspect, setEditAspect] = useState(1080 / 1500);
  useWorkshopShortcuts(props.undo, props.redo);

  useEffect(() => {
    let alive = true;
    const key = props.session.backdrop?.key;
    if (key === undefined) return;
    void looksClient.sourceUrl(key).then(async (result) => {
      if (!result.ok) {
        if (alive) setStatus(result.error);
        return;
      }
      const loaded = await loadBackdrop(result.source.url);
      if (!alive) return;
      if (loaded === null) setStatus("That background picture could not be opened.");
      else setLoadedBackdrop({ key, image: loaded });
    });
    return () => {
      alive = false;
    };
  }, [props.session.backdrop?.key]);

  // Only the picture for the CURRENT key: a slow load for a replaced background
  // must not flash the old one back in.
  const image =
    loadedBackdrop !== null && loadedBackdrop.key === props.session.backdrop?.key ? loadedBackdrop.image : null;

  const goBack = (): void => {
    if (edit) {
      if (!backArmed) {
        setBackArmed(true);
        return;
      }
      props.onOp({ kind: "clear" });
      props.onFinishEdit();
      return;
    }
    if (props.scene.items.length > 0 && !backArmed) {
      setBackArmed(true);
      return;
    }
    props.onSession({ workshop: "menu", merge: false });
  };

  const saveLook = useCallback(async (): Promise<void> => {
    if (!props.paired) {
      setStatus("Pair this device to save a photo booth look.");
      return;
    }
    setStatus("Preparing your look…");
    const backdrop =
      props.session.backdrop !== null && image !== null
        ? {
            image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            ...props.session.backdrop,
          }
        : null;
    const layers = await renderLookLayers({
      shots: props.session.shots,
      paper: props.session.paper,
      backdrop,
      scene: props.scene,
    });
    if (layers === null) {
      setStatus("This browser could not prepare the look.");
      return;
    }
    const result = await looksClient.save({
      name: name.trim() || nextLookName(),
      shots: props.session.shots,
      ink: tools.ink,
      ...layers,
    });
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    nextLookNumber += 1;
    props.onLookSaved?.(result.look);
    setStatus("Saved to the photo booth.");
    setNameOpen(false);
    setName(nextLookName());
  }, [image, name, props, tools.ink]);

  const save = (): void => {
    if (edit) {
      props.onFinishEdit();
      return;
    }
    if (!props.paired) {
      setStatus("Pair this device to save a photo booth look.");
      return;
    }
    setNameOpen(true);
  };

  const upload = async (file: File): Promise<void> => {
    setStatus("Uploading background…");
    const result = await looksClient.uploadSource(file);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setStatus(null);
    props.onSession({
      backdrop: { key: result.source.key, x: 0.5, y: 0.5, scale: 1 },
    });
  };

  if (edit && props.editStripUrl === null) {
    return (
      <section className={`${styles.workshop} ${styles.emptyState}`}>
        <h1>No booth strip yet</h1>
        <p>Take a strip in the photo booth before opening the drawing table.</p>
        <button type="button" onClick={() => props.onSession({ workshop: "menu" })}>
          Back to workshops
        </button>
      </section>
    );
  }

  return (
    <section className={styles.workshop}>
      <header className={styles.workshopHeader}>
        <button type="button" className={styles.backButton} onClick={goBack}>
          {backArmed ? (edit ? "Discard edits?" : "Leave design?") : edit ? "← Back to booth" : "← Workshops"}
        </button>
        <div>
          <p className={styles.eyebrow}>{edit ? "Finishing table" : "Look workshop"}</p>
          <h1>{edit ? "Edit your booth strip" : "Photo strip designer"}</h1>
        </div>
      </header>

      <main className={styles.table}>
        <div className={styles.stripWrap}>
          {edit ? (
            <ArtworkCanvas
              aspect={editAspect}
              imageUrl={props.editStripUrl}
              imageAlt="Your developed photo strip"
              canvasLabel="Photo strip drawing canvas"
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
              onImageLoad={(loaded) => {
                if (loaded.naturalWidth > 0 && loaded.naturalHeight > 0) {
                  setEditAspect(loaded.naturalWidth / loaded.naturalHeight);
                }
              }}
            />
          ) : (
            <StripCanvas
              scene={props.scene}
              shots={props.session.shots}
              paper={props.session.paper}
              backdrop={props.session.backdrop}
              image={image}
              merge={props.session.merge}
              localStream={props.localStream}
              remoteStream={props.remoteStream}
              identity={props.identity}
              sharedNow={props.sharedNow}
              tool={tools.tool}
              ink={tools.ink}
              width={tools.width}
              glyph={tools.glyph}
              stickerScale={tools.stickerScale}
              selectedStickerId={tools.selectedStickerId}
              backdropEditing={backdropEditing}
              onSelectedSticker={tools.selectSticker}
              onOp={props.onOp}
              onBackdrop={(patch) => {
                if (props.session.backdrop === null) return;
                props.onSession({
                  backdrop: {
                    ...props.session.backdrop,
                    ...patch,
                    scale: Math.max(BACKDROP_MIN_SCALE, Math.min(BACKDROP_MAX_SCALE, patch.scale)),
                  },
                });
              }}
            />
          )}
        </div>
        {!edit && (
          <button
            type="button"
            className={styles.mergeButton}
            aria-pressed={props.session.merge}
            onClick={() => props.onSession({ merge: !props.session.merge })}
          >
            <span aria-hidden>◒</span>
            Merge
          </button>
        )}
      </main>

      <div className={styles.tray}>
        {!edit && <ShotsBar shots={props.session.shots} onShots={(shots) => props.onSession({ shots })} />}
        <ColorBar
          colour={tools.ink}
          paper={props.session.paper}
          target={colourTarget}
          allowPaper={!edit}
          onTarget={setColourTarget}
          onColour={(value) => {
            if (colourTarget === "paper" && !edit) props.onSession({ paper: value });
            else tools.setInk(value);
          }}
        />
        <ToolBar tool={tools.tool} width={tools.width} onTool={tools.setTool} onWidth={tools.setWidth} />
        <StickerBar
          glyph={tools.glyph}
          scale={tools.stickerScale}
          selected={tools.selectedStickerId !== null}
          onGlyph={tools.setGlyph}
          onScale={tools.changeStickerScale}
        />
        {!edit && (
          <BackdropBar
            paired={props.paired}
            backdrop={props.session.backdrop}
            editing={backdropEditing}
            onUpload={(file) => void upload(file)}
            onEditing={setBackdropEditing}
            onReset={() =>
              props.onSession({
                backdrop:
                  props.session.backdrop === null
                    ? null
                    : { ...props.session.backdrop, x: 0.5, y: 0.5, scale: 1 },
              })
            }
            onRemove={() => {
              setBackdropEditing(false);
              props.onSession({ backdrop: null });
            }}
          />
        )}
        <ActionBar
          canUndo={props.canUndo}
          canRedo={props.canRedo}
          onUndo={props.undo}
          onRedo={props.redo}
          onClear={() => props.onOp({ kind: "clear" })}
          onSave={save}
        />
        {nameOpen && !edit && (
          <div className={styles.savePopover} role="dialog" aria-label="Save photo booth look">
            <label>
              Look name
              <input
                autoFocus
                aria-label="Look name"
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setNameOpen(false);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    void saveLook();
                  }
                }}
              />
            </label>
            <button type="button" className={styles.saveButton} onClick={() => void saveLook()}>
              Save look
            </button>
            <button type="button" onClick={() => setNameOpen(false)}>
              Cancel
            </button>
          </div>
        )}
        {status !== null && (
          <p role="status" className={styles.status}>
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
