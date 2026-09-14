"use client";

import { useState } from "react";
import { INKS } from "@/lib/createspace/ops";
import styles from "../CreateSpace.module.css";

const EXTRA_COLOURS = [
  "#ff7a90",
  "#ff9d55",
  "#ffd56a",
  "#b6dc72",
  "#64c7c8",
  "#71a6ed",
  "#9c7ae7",
  "#d27ac7",
  "#4a304b",
  "#7d4e37",
  "#a87d24",
  "#f7fbff",
  "#9ca4b9",
  "#293258",
  "#182032",
  "#12121b",
];
const RECENTS_KEY = "createspace-recent-colours";

function savedRecents(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function ColorBar({
  colour,
  paper,
  target,
  allowPaper = true,
  onColour,
  onTarget,
}: {
  colour: string;
  paper: string;
  target: "ink" | "paper";
  allowPaper?: boolean;
  onColour: (colour: string) => void;
  onTarget: (target: "ink" | "paper") => void;
}) {
  const [recents, setRecents] = useState<string[]>(savedRecents);
  const active = target === "paper" ? paper : colour;

  const choose = (next: string): void => {
    onColour(next);
    const updated = [next, ...recents.filter((entry) => entry !== next)].slice(0, 8);
    setRecents(updated);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
    } catch {
      // Private browsing can deny storage; the palette still works for this render.
    }
  };

  return (
    <div className={`${styles.trayBar} ${styles.colourBar}`} role="toolbar" aria-label="Colours">
      <span className={styles.trayLabel}>Colour</span>
      {allowPaper && (
        <div role="radiogroup" aria-label="Colour target" className={styles.segmented}>
          <button type="button" role="radio" aria-checked={target === "ink"} onClick={() => onTarget("ink")}>
            Ink
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={target === "paper"}
            onClick={() => onTarget("paper")}
          >
            Paper
          </button>
        </div>
      )}
      <span
        className={styles.currentColour}
        style={{ backgroundColor: active }}
        aria-label={`Current colour ${active}`}
      />
      <div className={styles.swatchGrid} aria-label="Colour swatches">
        {[...INKS, ...EXTRA_COLOURS].map((entry) => (
          <button
            key={entry}
            type="button"
            aria-label={`Choose ${entry}`}
            aria-pressed={active === entry}
            onClick={() => choose(entry)}
            style={{ backgroundColor: entry }}
          />
        ))}
      </div>
      <label className={styles.colourInput}>
        Mix
        <input
          aria-label="Custom colour"
          type="color"
          value={active}
          onChange={(event) => choose(event.target.value.toLowerCase())}
        />
      </label>
      <input
        key={active}
        aria-label="Colour hex value"
        defaultValue={active}
        maxLength={7}
        className={styles.hexInput}
        onChange={(event) => {
          const next = event.target.value.toLowerCase();
          if (/^#[0-9a-f]{6}$/.test(next)) choose(next);
        }}
      />
      {recents.length > 0 && (
        <div className={styles.recentColours} aria-label="Recent colours">
          {recents.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-label={`Recent ${entry}`}
              style={{ backgroundColor: entry }}
              onClick={() => choose(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
