"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { moves, type AlbumItem } from "@/lib/album/types";
import { formatAlbumDate } from "./room-album/format";
import styles from "./MemoryOverlay.module.css";

/** Long enough for a sentence about the evening, short enough for the paper tag. */
export const NOTE_MAX = 200;

const noSubscription = () => () => undefined;

/**
 * True only in the browser, and false during the server render and hydration,
 * so the portal never makes the two renders disagree.
 */
function useInBrowser(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * One memory, taken down from its lantern and held up close.
 *
 * Portalled to the page body: in a call the album lives inside a fixed 16:9
 * screen with overflow hidden, and an overlay drawn inside it would be clipped
 * to that screen instead of covering the room.
 *
 * The note here IS the lantern's caption -- the same field, saved through the
 * same handler -- so the paper tag under the lantern changes the moment this
 * one does.
 */
export function MemoryOverlay({
  item,
  onClose,
  onSaveCaption,
}: {
  item: AlbumItem;
  onClose: () => void;
  onSaveCaption: (item: AlbumItem, caption: string | null) => void | Promise<unknown>;
}): ReactElement | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inBrowser = useInBrowser();

  // Focus the way out on open, give focus back on close, and stop the page
  // behind from scrolling while a memory is held up.
  // Keyed on being in the browser, so an overlay present from the first render
  // still gets its focus once the portal actually exists.
  useEffect(() => {
    if (!inBrowser) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [inBrowser]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSaveCaption(item, draft.trim() === "" ? null : draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!inBrowser) return null;
  const date = formatAlbumDate(item.happenedAt);

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(event) => {
        // Only the dark around the memory closes it; a click on the picture or
        // the note is somebody looking, not somebody leaving.
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={`Memory from ${date}`} className={styles.dialog}>
        <button ref={closeRef} type="button" aria-label="Close" className={styles.close} onClick={onClose}>
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>

        <figure className={styles.print}>
          {moves(item.kind) ? (
            <video
              key={item.id}
              src={item.url}
              poster={item.posterUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              className={styles.media}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL on an unknown host.
            <img
              key={item.id}
              src={item.url}
              alt={item.caption ?? `A memory from ${date}`}
              className={styles.media}
            />
          )}
        </figure>

        <div className={styles.tag}>
          <p className={styles.date}>{date}</p>
          {editing ? (
            <form
              className={styles.editor}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <textarea
                autoFocus
                aria-label="Note"
                value={draft}
                maxLength={NOTE_MAX}
                rows={3}
                className={styles.textarea}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    // Escape leaves the note, not the memory.
                    event.stopPropagation();
                    setEditing(false);
                  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void save();
                  }
                }}
              />
              <div className={styles.actions}>
                <button type="submit" className={styles.save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className={styles.cancel} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className={item.caption === null ? styles.noteEmpty : styles.note}>
                {item.caption ?? "No note yet."}
              </p>
              <button
                type="button"
                className={styles.edit}
                onClick={() => {
                  setDraft(item.caption ?? "");
                  setEditing(true);
                }}
              >
                {item.caption === null ? "Add a note" : "Edit note"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
