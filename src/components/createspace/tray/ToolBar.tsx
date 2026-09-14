"use client";

import { MAX_WIDTH, MIN_WIDTH, TOOLS, type Tool } from "@/lib/createspace/ops";
import styles from "../CreateSpace.module.css";

function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === "pencil") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="m4 20 4.2-1 11-11-3.3-3.3-11 11L4 20Z" />
        <path d="m14.8 5.8 3.3 3.3M5.1 16l2.9 2.9" />
      </svg>
    );
  }
  if (tool === "brush") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M14.5 4.2c1.3-1.3 3.4-1.3 4.7 0s1.3 3.4 0 4.7l-7.8 7.8-4.7-4.7 7.8-7.8Z" />
        <path d="M10.6 16.1c-.2 2.7-2.2 4.2-6.1 3.4 1.3-1 1.2-2.1 1.4-3.2.3-1.8 2.1-2.8 4.7-.2Z" />
      </svg>
    );
  }
  if (tool === "spray") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M8 9h9v11H8zM10 9V6h5l2 3M16 4h3" />
        <path d="M4 7h.1M4 11h.1M6 4h.1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m5 15 7-9 7 6-6 8H9l-4-5Z" />
      <path d="M9 20h10" />
    </svg>
  );
}

export function ToolBar({
  tool,
  width,
  onTool,
  onWidth,
}: {
  tool: Tool;
  width: number;
  onTool: (tool: Tool) => void;
  onWidth: (width: number) => void;
}) {
  return (
    <div className={styles.trayBar} role="toolbar" aria-label="Drawing tools">
      <span className={styles.trayLabel}>Tools</span>
      <div className={styles.toolGroup} role="radiogroup" aria-label="Drawing tool">
        {TOOLS.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={tool === item}
            aria-label={item}
            onClick={() => onTool(item)}
            className={styles.toolButton}
          >
            <ToolIcon tool={item} />
          </button>
        ))}
      </div>
      <label className={styles.rangeLabel}>
        Size
        <input
          aria-label="Line size"
          type="range"
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          step="0.001"
          value={width}
          onChange={(event) => onWidth(Number(event.target.value))}
        />
      </label>
      <span
        aria-hidden
        className={styles.sizeDot}
        style={{
          width: `${Math.max(7, width * 120)}px`,
          height: `${Math.max(7, width * 120)}px`,
        }}
      />
    </div>
  );
}
