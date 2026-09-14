"use client";

import type { ReactElement } from "react";
import { WEB_GAMES, webGame, type WebGameId } from "@/lib/gameword/webGames";
import styles from "./GameWord.module.css";

type Props = {
  webGameId: WebGameId | null;
  onWebGame: (id: WebGameId | null) => void;
  onBack?: () => void;
};

export function WebGameLauncher({ webGameId, onWebGame, onBack }: Props): ReactElement {
  if (webGameId !== null) {
    const selected = webGame(webGameId);
    return (
      <section className={`${styles.arcade} ${styles.player}`} aria-label={`${selected.name} web game`}>
        <div className={styles.toolbar}>
          <h2 className={styles.toolbarTitle}>
            <span aria-hidden>{selected.icon}</span> {selected.name}
          </h2>
          <div className={styles.toolbarActions}>
            <a href={selected.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
              Open in new tab
            </a>
            <button type="button" className={styles.button} onClick={() => onWebGame(null)}>
              Close
            </button>
          </div>
        </div>
        {selected.embed ? (
          <p className={styles.hint}>
            Make a private room in the game and share its link with each other. If the frame stays blank, open
            it in a new tab.
          </p>
        ) : null}
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
              {selected.name} opens in its own tab so both of you can play there.
            </p>
            {/* A real link, not window.open: a tab can only open from this
                person's own click, never from a message the other screen sent. */}
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
          Choosing one opens it on both screens. Some play right here; the rest open in a new tab.
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
