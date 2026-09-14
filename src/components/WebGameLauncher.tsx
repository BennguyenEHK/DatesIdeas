"use client";

import { useState, type ReactElement } from "react";
import { WEB_GAMES, webGame, type WebGameId } from "@/lib/gameword/webGames";
import styles from "./GameWord.module.css";

type Props = {
  webGameId: WebGameId | null;
  onWebGame: (id: WebGameId | null) => void;
  onBack?: () => void;
};

const BLANK_FRAME_TIP = "If the frame stays blank, open it in a new tab.";

export function WebGameLauncher({ webGameId, onWebGame, onBack }: Props): ReactElement {
  const [tipHidden, setTipHidden] = useState(false);

  if (webGameId !== null) {
    const selected = webGame(webGameId);
    return (
      // Exactly the movie screen's size: the game gets every pixel the slim
      // toolbar does not, and nothing here can make the view taller than it.
      <section className={`${styles.arcade} ${styles.player}`} aria-label={`${selected.name} web game`}>
        <div className={styles.toolbar}>
          <h2 className={styles.toolbarTitle}>
            <span aria-hidden>{selected.icon}</span> {selected.name}
          </h2>
          {selected.embed && !tipHidden ? (
            <p className={styles.hint}>
              <span className={styles.hintText}>
                Join the same room inside the game to play together. {BLANK_FRAME_TIP}
              </span>
              <button
                type="button"
                aria-label="Hide tip"
                className={styles.hintDismiss}
                onClick={() => setTipHidden(true)}
              >
                ×
              </button>
            </p>
          ) : null}
          <div className={styles.toolbarActions}>
            <a
              href={selected.url}
              target="_blank"
              rel="noopener noreferrer"
              title={BLANK_FRAME_TIP}
              className={styles.link}
            >
              Open in new tab
            </a>
            <button
              type="button"
              className={`${styles.button} ${styles.compact}`}
              onClick={() => onWebGame(null)}
            >
              Close
            </button>
          </div>
        </div>
        {selected.embed ? (
          <iframe
            title={selected.name}
            src={selected.url}
            allow="autoplay; fullscreen; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer-when-downgrade"
            loading="eager"
            className={styles.frame}
          />
        ) : (
          <div className={styles.tabCard}>
            <p className={styles.panelIntro}>
              {selected.name} opens in its own tab. Join the same room there to play together.
            </p>
            {/* A real link, not window.open: a tab should only open from this
                person's own click. */}
            <div className={styles.actions}>
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.buttonPrimary}
              >
                Open {selected.name}
              </a>
              <button type="button" className={styles.button} onClick={() => onWebGame(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={styles.arcade} aria-label="Web game launcher">
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Web games</h2>
          {onBack ? (
            <button type="button" className={styles.back} onClick={onBack}>
              Back to games
            </button>
          ) : null}
        </div>
        <p className={styles.panelIntro}>
          Each of you opens a game on your own screen, then joins the same room inside it to play together.
          Some play right here; the rest open in a new tab.
        </p>
        <div className={styles.gameGrid}>
          {WEB_GAMES.map((game) => (
            <button
              key={game.id}
              type="button"
              className={styles.gameCard}
              onClick={() => onWebGame(game.id)}
            >
              <span aria-hidden className={styles.gameIcon}>
                {game.icon}
              </span>
              <span className={styles.gameName}>{game.name}</span>
              <span className={styles.gameNote}>{game.note}</span>
              <span className={`${styles.chip} ${game.embed ? styles.chipHere : styles.chipTab}`}>
                {game.embed ? "Plays here" : "Opens in a new tab"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
