"use client";

import { useState, type ReactElement } from "react";
import { GameBoard } from "@/components/GameBoard";
import { MinecraftLauncher } from "@/components/MinecraftLauncher";
import {
  GAME_IDS,
  GAME_LABELS,
  seatOf,
  type GameId,
  type GameMove,
  type GameState,
} from "@/lib/gameword/games";

type Props = {
  identity: string;
  partnerIdentity: string | null;
  game: GameState | null;
  error: string | null;
  onStart: (game: GameId) => void;
  onMove: (move: GameMove) => void;
  onLeave: () => void;
};

function Picker({ partnerIdentity, onStart }: Pick<Props, "partnerIdentity" | "onStart">) {
  const [showMinecraft, setShowMinecraft] = useState(false);
  if (showMinecraft) return <MinecraftLauncher onBack={() => setShowMinecraft(false)} />;
  return (
    <section
      className="border border-[var(--edge)] bg-[var(--letterbox)] p-5 sm:p-7"
      aria-label="Choose a game"
    >
      <h2 className="font-[family-name:var(--font-display)] text-4xl text-[var(--dress)]">
        Choose your game
      </h2>
      {partnerIdentity === null ? (
        <p className="mt-3 text-[var(--mist)]">
          A game starts when the other person joins the call.
        </p>
      ) : null}
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {GAME_IDS.map((game) => (
          <button
            key={game}
            type="button"
            disabled={partnerIdentity === null}
            onClick={() => onStart(game)}
            className="min-h-24 border border-[var(--edge)] bg-[var(--dusk)] p-4 text-left text-[var(--cream)] enabled:hover:border-[var(--lamp)] disabled:text-[var(--mist)]"
          >
            <span className="font-[family-name:var(--font-display)] text-2xl text-[var(--lamp)]">
              {GAME_LABELS[game]}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowMinecraft(true)}
        className="mt-5 border border-[var(--lamp)] bg-[var(--night)] px-4 py-3 text-[var(--cream)]"
      >
        Open Minecraft launcher
      </button>
    </section>
  );
}

function resultMessage(game: GameState, mine: 0 | 1 | null): string {
  if (game.status === "drawn") return "A draw";
  if (game.winner === mine) return "You won";
  return "They won";
}

export function GameWord(props: Props): ReactElement {
  const [confirmingResign, setConfirmingResign] = useState(false);
  if (props.game === null)
    return <Picker partnerIdentity={props.partnerIdentity} onStart={props.onStart} />;

  const game = props.game;
  const mine = seatOf(game, props.identity);
  const playing = game.status === "playing";
  const turnMessage = mine === game.turn ? "Your move" : "Their move";
  return (
    <section
      className="border border-[var(--edge)] bg-[var(--letterbox)] p-4 sm:p-7"
      aria-label={`${GAME_LABELS[game.game]} game`}
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-3xl text-[var(--dress)]">
          {GAME_LABELS[game.game]}
        </h2>
        <p role="status" className="text-sm text-[var(--mist)]">
          {playing ? turnMessage : resultMessage(game, mine)}
        </p>
      </div>
      <GameBoard game={game} identity={props.identity} onMove={props.onMove} />
      {props.error ? (
        <p role="alert" className="mt-4 border-l-2 border-[var(--neon)] pl-3 text-[var(--cream)]">
          {props.error}
        </p>
      ) : null}
      {playing ? (
        <div className="mt-5">
          {confirmingResign ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-[var(--mist)]">Concede this game?</p>
              <button
                type="button"
                onClick={() => props.onMove({ kind: "resign" })}
                className="border border-[var(--lamp)] px-3 py-2 text-[var(--cream)]"
              >
                Yes, concede
              </button>
              <button
                type="button"
                onClick={() => setConfirmingResign(false)}
                className="px-3 py-2 text-[var(--mist)]"
              >
                Keep playing
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingResign(true)}
              className="text-sm text-[var(--mist)] underline decoration-[var(--lamp)] underline-offset-4"
            >
              Concede game
            </button>
          )}
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => props.onStart(game.game)}
            className="bg-[var(--lamp)] px-4 py-2 text-[var(--night)]"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={props.onLeave}
            className="border border-[var(--edge)] px-4 py-2 text-[var(--cream)]"
          >
            Choose another game
          </button>
        </div>
      )}
    </section>
  );
}
