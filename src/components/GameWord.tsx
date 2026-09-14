"use client";

import { useState, type ReactElement } from "react";
import { MinecraftLauncher } from "@/components/MinecraftLauncher";
import { WebGameLauncher } from "@/components/WebGameLauncher";
import type { WebGameId } from "@/lib/gameword/webGames";
import styles from "./GameWord.module.css";

type View = "menu" | "web" | "minecraft";

/**
 * GameWord, entirely on this screen.
 *
 * Nothing here crosses to the other person: each of you picks, opens and
 * closes your own game, and each browser runs its own copy of the site. You
 * meet inside the game by joining the same room there.
 */
export function GameWord(): ReactElement {
  const [view, setView] = useState<View>("menu");
  const [webGame, setWebGame] = useState<WebGameId | null>(null);

  if (webGame !== null) return <WebGameLauncher webGameId={webGame} onWebGame={setWebGame} />;
  if (view === "web") {
    return <WebGameLauncher webGameId={null} onWebGame={setWebGame} onBack={() => setView("menu")} />;
  }
  if (view === "minecraft") return <MinecraftLauncher onBack={() => setView("menu")} />;

  return (
    <section className={styles.arcade} aria-label="Choose a game">
      <header className={styles.hero}>
        <div aria-hidden className={styles.sunGlow} />
        <div aria-hidden className={styles.sun} />
        <div aria-hidden className={styles.floor} />
        <h2 className={styles.sign}>GameWord</h2>
      </header>

      <div className={styles.menu}>
        <p className={styles.lede}>Pick somewhere to play together while you stay on the call.</p>
        <div className={styles.cabinets}>
          <button type="button" className={styles.cabinet} onClick={() => setView("web")}>
            <GlobeIcon />
            <span className={styles.cabinetTitle}>Web games</span>
            <span className={styles.cabinetNote}>
              Free games for two, from drawing and guessing to cards and chess.
            </span>
          </button>
          <button
            type="button"
            className={`${styles.cabinet} ${styles.cabinetCyan}`}
            onClick={() => setView("minecraft")}
          >
            <CubeIcon />
            <span className={styles.cabinetTitle}>Minecraft</span>
            <span className={styles.cabinetNote}>Join the server one of you hosts.</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function GlobeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={styles.cabinetIcon} fill="none" stroke="currentColor">
      <circle cx="24" cy="24" r="17" strokeWidth="2.5" />
      <path d="M7 24h34M24 7c-6 5-8 11-8 17s2 12 8 17c6-5 8-11 8-17s-2-12-8-17Z" strokeWidth="2" />
      <path d="M11 15h26M11 33h26" strokeWidth="1.5" opacity="0.7" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={styles.cabinetIcon} fill="none" stroke="currentColor">
      <path d="M24 6 40 15v18L24 42 8 33V15Z" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M8 15l16 9 16-9M24 24v18" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 19.5v9M32 19.5v9" strokeWidth="1.5" opacity="0.7" />
    </svg>
  );
}
