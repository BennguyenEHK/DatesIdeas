"use client";

import type { ChangeEvent } from "react";
import type { Backdrop } from "@/lib/createspace/session";
import { LOOK_SOURCE_TYPES } from "@/lib/looks/types";
import styles from "../CreateSpace.module.css";

export function BackdropBar({
  paired,
  backdrop,
  editing,
  onUpload,
  onEditing,
  onReset,
  onRemove,
}: {
  paired: boolean;
  backdrop: Backdrop | null;
  editing: boolean;
  onUpload: (file: File) => void;
  onEditing: (editing: boolean) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file !== undefined) onUpload(file);
    event.target.value = "";
  };

  return (
    <div className={styles.trayBar} role="toolbar" aria-label="Background picture">
      <span className={styles.trayLabel}>Backdrop</span>
      <label
        className={styles.uploadButton}
        title={!paired ? "Pair this device to use your own backgrounds" : undefined}
      >
        Add picture
        <input
          aria-label="Upload background"
          type="file"
          accept={LOOK_SOURCE_TYPES.join(",")}
          disabled={!paired}
          onChange={upload}
        />
      </label>
      {!paired && <span className={styles.disabledReason}>Pair this device to use your own backgrounds</span>}
      <button
        type="button"
        disabled={backdrop === null}
        aria-pressed={editing}
        onClick={() => onEditing(!editing)}
      >
        Move / resize
      </button>
      <button type="button" disabled={backdrop === null} onClick={onReset}>
        Reset
      </button>
      <button type="button" disabled={backdrop === null} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}
