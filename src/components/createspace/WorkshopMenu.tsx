"use client";

import { motion, useReducedMotion } from "motion/react";
import type { CanvasOp } from "@/lib/createspace/ops";
import { DEFAULT_PAPER, type CreateSession } from "@/lib/createspace/session";
import styles from "./CreateSpace.module.css";

type TileKind = "strip" | "doodle" | "scrapbook" | "postcard";

function WorkshopIcon({ kind }: { kind: TileKind }) {
  if (kind === "strip") {
    return (
      <svg viewBox="0 0 96 76" aria-hidden>
        <path d="M32 5c8 2 25-1 32 3l3 61c-9 2-29-2-39 1L32 5Z" />
        <path d="M37 12h24v14H36l1-14Zm0 20h25v14H37V32Zm1 20h24v11H38V52Z" />
        <path d="M27 16c-7 4-10 11-13 18m4-2-6 4 1-7M72 16c7 3 11 9 13 16" />
      </svg>
    );
  }
  if (kind === "doodle") {
    return (
      <svg viewBox="0 0 96 76" aria-hidden>
        <path d="M15 58c13-3 29 5 41 0 8-3 15-2 24 1L77 15c-15 2-31-3-47 1-5 12-8 28-15 42Z" />
        <path d="m34 53 29-33 8 7-30 31-9 3 2-8Z" />
        <path d="M25 29c6 0 7 5 4 8-4 3-9-1-7-5 2-5 10-6 15-2" />
      </svg>
    );
  }
  if (kind === "scrapbook") {
    return (
      <svg viewBox="0 0 96 76" aria-hidden>
        <path d="M20 12c18 2 35-1 55 2l-2 50c-18-3-35 1-54-2l1-50Z" />
        <path d="M29 8v9m12-9v9m12-9v9m12-8v9M32 28l12-5 6 12-12 5-6-12Zm24 12 11 4-5 12-11-5 5-11Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 76" aria-hidden>
      <path d="m15 20 63-6 4 43-62 6-5-43Z" />
      <path d="m18 22 32 19 28-25M61 28l12 12M28 48l-7 10" />
      <path d="M69 45c3-5 9-2 7 2-1 3-4 5-7 8-3-2-7-4-8-7-2-5 5-7 8-3Z" />
    </svg>
  );
}

export function WorkshopMenu({
  onSession,
  onOp,
}: {
  onSession: (patch: Partial<Omit<CreateSession, "at" | "by">>) => void;
  onOp: (op: CanvasOp) => void;
}) {
  const reducedMotion = useReducedMotion();
  const open = (workshop: "strip" | "doodle"): void => {
    onOp({ kind: "clear" });
    onSession(
      workshop === "strip"
        ? {
            workshop,
            mode: "new",
            shots: 1,
            paper: DEFAULT_PAPER,
            backdrop: null,
            merge: false,
          }
        : { workshop },
    );
  };
  const tiles: Array<{
    kind: TileKind;
    title: string;
    note: string;
    onClick?: () => void;
  }> = [
    {
      kind: "strip",
      title: "Photo strip",
      note: "Design a new look for the photo booth",
      onClick: () => open("strip"),
    },
    {
      kind: "doodle",
      title: "Draw together",
      note: "Turn an album picture into a shared mural",
      onClick: () => open("doodle"),
    },
    { kind: "scrapbook", title: "Scrapbook", note: "Layer the night into a keepsake" },
    { kind: "postcard", title: "Postcards", note: "Send a little scene from here" },
  ];

  return (
    <section className={styles.menu} aria-labelledby="createspace-menu-title">
      <div className={styles.menuHead}>
        <p className={styles.eyebrow}>FestiBooth workshop</p>
        <h1 id="createspace-menu-title">CreateSpace</h1>
        <p>Make a little something together, then bring it back to the booth.</p>
      </div>
      <div className={styles.menuGrid}>
        {tiles.map((tile, index) => (
          <motion.button
            key={tile.title}
            type="button"
            disabled={tile.onClick === undefined}
            onClick={tile.onClick}
            whileHover={
              tile.onClick !== undefined && !reducedMotion
                ? { y: -7, rotate: index % 2 === 0 ? -1.2 : 1.2 }
                : undefined
            }
            whileTap={tile.onClick === undefined ? undefined : { scale: 0.96 }}
            className={`${styles.workshopTile} ${styles[`tile${index + 1}`]}`}
          >
            {tile.onClick === undefined && <span className={styles.ribbon}>Coming soon</span>}
            <span className={styles.workshopIcon}>
              <WorkshopIcon kind={tile.kind} />
            </span>
            <span className={styles.workshopTitle}>{tile.title}</span>
            <span className={styles.workshopNote}>{tile.note}</span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
