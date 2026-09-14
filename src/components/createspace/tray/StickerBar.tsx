"use client";

import { MAX_SCALE, MIN_SCALE, STICKERS, type Glyph } from "@/lib/createspace/ops";
import styles from "../CreateSpace.module.css";

export function StickerBar({
  glyph,
  scale,
  selected,
  onGlyph,
  onScale,
}: {
  glyph: Glyph | null;
  scale: number;
  selected: boolean;
  onGlyph: (glyph: Glyph | null) => void;
  onScale: (scale: number) => void;
}) {
  return (
    <div className={styles.trayBar} role="toolbar" aria-label="Stickers">
      <span className={styles.trayLabel}>Stickers</span>
      <div className={styles.stickerScroll}>
        {STICKERS.map((item) => (
          <button
            key={item}
            type="button"
            aria-label={`Sticker ${item}`}
            aria-pressed={glyph === item}
            onClick={() => onGlyph(glyph === item ? null : item)}
          >
            {item}
          </button>
        ))}
      </div>
      <label className={styles.rangeLabel}>
        {selected ? "Selected size" : "New size"}
        <input
          aria-label="Sticker size"
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step="0.1"
          value={scale}
          onChange={(event) => onScale(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
