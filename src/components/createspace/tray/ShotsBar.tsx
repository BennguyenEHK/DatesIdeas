"use client";

import { SHOT_COUNTS, type ShotCount } from "@/lib/photo/strip";
import styles from "../CreateSpace.module.css";

export function ShotsBar({ shots, onShots }: { shots: ShotCount; onShots: (shots: ShotCount) => void }) {
  return (
    <div className={styles.trayBar} role="radiogroup" aria-label="Number of photos">
      <span className={styles.trayLabel}>Shots</span>
      <div className={styles.segmented}>
        {SHOT_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            role="radio"
            aria-checked={shots === count}
            onClick={() => onShots(count)}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  );
}
