"use client";

import { type CSSProperties, useRef } from "react";
import { moves, type AlbumItem } from "@/lib/album/types";
import { skyLanterns, stepSelection } from "@/lib/album/sky";
import { formatAlbumDate } from "./room-album/format";
import styles from "./MemorySky.module.css";

export function MemorySky({
  items,
  selectedId,
  onSelect,
}: {
  items: AlbumItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const pointerStart = useRef<number | null>(null);
  const ids = items.map((item) => item.id);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const lanterns = skyLanterns(items, selected?.id ?? null);
  const step = (direction: -1 | 1) => {
    const next = stepSelection(ids, selected?.id ?? null, direction);
    if (next !== null && next !== selected?.id) onSelect(next);
  };

  if (selected === null) return null;

  return (
    <section
      aria-label="Memory sky"
      tabIndex={0}
      className={styles.stage}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          step(1);
        }
      }}
      onPointerDown={(event) => {
        pointerStart.current = event.pointerType === "touch" ? event.clientX : null;
      }}
      onPointerUp={(event) => {
        if (pointerStart.current === null) return;
        const distance = event.clientX - pointerStart.current;
        pointerStart.current = null;
        if (Math.abs(distance) >= 42) step(distance < 0 ? 1 : -1);
      }}
    >
      <div aria-hidden className={styles.milkyBand} />
      <div aria-hidden className={`${styles.stars} ${styles.starsFar}`} />
      <div aria-hidden className={`${styles.stars} ${styles.starsNear}`} />
      <div aria-hidden className={styles.horizonGlow} />
      <div aria-hidden className={styles.ambientLanterns}>
        <span />
        <span />
        <span />
      </div>
      <div aria-hidden className={styles.mist} />
      {lanterns.map((lantern) => {
        const isSelected = lantern.slot === 0;
        const picture = lantern.item.posterUrl ?? lantern.item.url;
        return (
          <button
            key={lantern.item.id}
            type="button"
            aria-current={isSelected ? "true" : undefined}
            aria-label={isSelected ? "Selected memory" : `Show ${formatAlbumDate(lantern.item.happenedAt)}`}
            className={`${styles.lantern} ${isSelected ? styles.lanternSelected : ""}`}
            style={
              {
                "--sky-x": `calc(${lantern.x}cqw - 50%)`,
                "--sky-y": `calc(${lantern.y}cqh - 50%)`,
                "--sky-scale": lantern.scale,
                "--sky-opacity": lantern.opacity,
                "--sky-depth": lantern.depth,
                "--sky-duration": `${lantern.duration}s`,
                "--sky-amplitude": `${lantern.amplitude}px`,
                "--sky-negative-amplitude": `${-lantern.amplitude * 0.3}px`,
                "--sky-delay": `${lantern.delay}s`,
                "--sky-sway": `${lantern.sway}deg`,
                "--sky-negative-sway": `${-lantern.sway}deg`,
              } as CSSProperties
            }
            onClick={() => onSelect(lantern.item.id)}
          >
            <span aria-hidden className={styles.lanternMotion}>
              <span className={styles.lanternBloom} />
              <span className={styles.lanternWire} />
              <span className={styles.lanternBody}>
                <span className={styles.lanternRibs} />
                <span className={styles.flame} />
                <span className={styles.photoPrint}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL on an unknown host. */}
                  <img src={picture} alt="" loading="lazy" decoding="async" className={styles.picture} />
                  {moves(lantern.item.kind) ? <span className={styles.play}>▶</span> : null}
                </span>
                <span className={styles.lanternOpening}>
                  <span className={styles.openingFlame} />
                </span>
              </span>
            </span>
            {isSelected ? (
              <span className={styles.caption}>
                <span>{formatAlbumDate(lantern.item.happenedAt)}</span>
                <strong>{lantern.item.caption ?? "A memory worth keeping"}</strong>
              </span>
            ) : null}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Previous memory"
        className={`${styles.arrow} ${styles.arrowPrevious}`}
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next memory"
        className={`${styles.arrow} ${styles.arrowNext}`}
        onClick={() => step(1)}
      >
        ›
      </button>
    </section>
  );
}
