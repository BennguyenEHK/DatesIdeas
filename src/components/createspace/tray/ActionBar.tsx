"use client";

import { useState } from "react";
import styles from "../CreateSpace.module.css";

export function ActionBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onSave,
  saveLabel = "Save",
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <div className={`${styles.trayBar} ${styles.actionBar}`} role="toolbar" aria-label="Actions">
      <span className={styles.trayLabel}>Actions</span>
      <button type="button" disabled={!canUndo} onClick={onUndo}>
        Undo
      </button>
      <button type="button" disabled={!canRedo} onClick={onRedo}>
        Redo
      </button>
      <button
        type="button"
        className={armed ? styles.dangerButton : undefined}
        onClick={() => {
          if (armed) {
            onClear();
            setArmed(false);
          } else {
            setArmed(true);
          }
        }}
      >
        {armed ? "Delete for both?" : "Delete"}
      </button>
      <button type="button" className={styles.saveButton} onClick={onSave}>
        {saveLabel}
      </button>
    </div>
  );
}
