"use client";

import type { ReactElement } from "react";
import { WEB_GAMES, webGame, type WebGameId } from "@/lib/gameword/webGames";

type Props = {
  webGameId: WebGameId | null;
  onWebGame: (id: WebGameId | null) => void;
  onBack?: () => void;
};

export function WebGameLauncher({ webGameId, onWebGame, onBack }: Props): ReactElement {
  if (webGameId !== null) {
    const selected = webGame(webGameId);
    return (
      <section
        className="flex h-full min-h-[30rem] flex-col bg-[var(--night)]"
        aria-label={`${selected.name} web game`}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--edge)]
          bg-[var(--letterbox)] p-3"
        >
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--dress)]">
            <span aria-hidden>{selected.icon}</span> {selected.name}
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a
              href={selected.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--lamp)] underline decoration-[var(--edge)] underline-offset-4"
            >
              Open in new tab
            </a>
            <button
              type="button"
              onClick={() => onWebGame(null)}
              className="border border-[var(--edge)] px-3 py-2 text-[var(--cream)]"
            >
              Close
            </button>
          </div>
        </div>
        <p className="border-b border-[var(--edge)] px-3 py-2 text-sm text-[var(--mist)]">
          Make a private room in the game and share its link with each other. If the frame stays blank, open
          it in a new tab.
        </p>
        {selected.embed ? (
          <iframe
            title={selected.name}
            src={selected.url}
            allow="autoplay; fullscreen; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer-when-downgrade"
            loading="eager"
            className="min-h-[24rem] flex-1 border-0"
          />
        ) : (
          <div className="m-4 border border-[var(--edge)] bg-[var(--dusk)] p-5 sm:m-7 sm:p-7">
            <p className="text-[var(--cream)]">
              {selected.name} opens in its own tab so both of you can play there.
            </p>
            <a
              href={selected.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-block bg-[var(--lamp)] px-4 py-3 text-[var(--night)]"
            >
              Open {selected.name}
            </a>
            <button
              type="button"
              onClick={() => onWebGame(null)}
              className="ml-3 border border-[var(--edge)] px-4 py-3 text-[var(--cream)]"
            >
              Close
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="border border-[var(--lamp)] bg-[var(--dusk)] p-5 sm:p-6"
      aria-label="Web game launcher"
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 text-sm text-[var(--mist)] underline decoration-[var(--edge)] underline-offset-4"
        >
          Back to games
        </button>
      ) : null}
      <h2 className="font-[family-name:var(--font-display)] text-3xl text-[var(--dress)]">
        Web games for two
      </h2>
      <p className="mt-2 text-[var(--mist)]">
        Pick a small game to play together while you stay on the call.
      </p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {WEB_GAMES.map((game) => (
          <button
            key={game.id}
            type="button"
            onClick={() => onWebGame(game.id)}
            className="min-h-36 border border-[var(--edge)] bg-[var(--letterbox)] p-4 text-left
              text-[var(--cream)] transition-colors hover:border-[var(--lamp)]"
          >
            <span className="text-2xl" aria-hidden>
              {game.icon}
            </span>
            <span className="mt-2 block font-[family-name:var(--font-display)] text-xl text-[var(--dress)]">
              {game.name}
            </span>
            <span className="mt-1 block text-sm text-[var(--mist)]">{game.note}</span>
            <span className="mt-3 inline-block border border-[var(--edge)] px-2 py-1 text-xs text-[var(--lamp)]">
              {game.embed ? "Plays here" : "Opens in a new tab"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
