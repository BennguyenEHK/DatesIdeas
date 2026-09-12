"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import {
  C4_COLS,
  C4_ROWS,
  normaliseWord,
  type GameMove,
  type GameState,
  type Seat,
} from "@/lib/gameword/games";

type Props = { game: GameState; identity: string; onMove: (move: GameMove) => void };

function piece(seat: Seat | null): string {
  return seat === null ? "Empty" : seat === 0 ? "Cross" : "Nought";
}

function mark(seat: Seat | null): string {
  return seat === null ? "" : seat === 0 ? "×" : "○";
}

function Tictactoe({ game, identity, onMove }: Props) {
  const mine = game.players.indexOf(identity) as Seat | -1;
  const canPlay = mine === game.turn && game.status === "playing";
  return (
    <div className="grid max-w-sm grid-cols-3 gap-1.5" aria-label="Noughts and crosses board">
      {game.board.map((cell, index) => {
        const active = game.line?.includes(index) ?? false;
        const enabled = canPlay && cell === null;
        return (
          <button
            key={index}
            type="button"
            disabled={!enabled}
            aria-label={`Square ${index + 1}, ${piece(cell)}`}
            onClick={() => onMove({ kind: "place", index })}
            className={`aspect-square border border-[var(--edge)] text-4xl font-medium transition-colors sm:text-5xl ${
              active
                ? "bg-[var(--lamp)] text-[var(--night)]"
                : "bg-[var(--dusk)] text-[var(--cream)]"
            } ${enabled ? "hover:border-[var(--lamp)] hover:bg-[var(--night)]" : "cursor-default"}`}
          >
            <span aria-hidden>{mark(cell)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ConnectFour({ game, identity, onMove }: Props) {
  const mine = game.players.indexOf(identity) as Seat | -1;
  const canPlay = mine === game.turn && game.status === "playing";
  return (
    <div className="max-w-xl" aria-label="Four in a row board">
      <div className="mb-2 grid grid-cols-7 gap-1.5">
        {Array.from({ length: C4_COLS }, (_, column) => {
          const full = game.board[column] !== null;
          const enabled = canPlay && !full;
          return (
            <button
              key={column}
              type="button"
              disabled={!enabled}
              aria-label={`Drop target, column ${column + 1}, ${full ? "full" : "open"}`}
              onClick={() => onMove({ kind: "place", index: column })}
              className="h-8 border border-[var(--edge)] bg-[var(--letterbox)] text-lg text-[var(--lamp)] disabled:text-[var(--mist)]"
            >
              <span aria-hidden>↓</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-7 gap-1.5 bg-[var(--dusk)] p-2 ring-1 ring-[var(--edge)]">
        {Array.from({ length: C4_ROWS * C4_COLS }, (_, index) => {
          const cell = game.board[index];
          const active = game.line?.includes(index) ?? false;
          const column = index % C4_COLS;
          const full = game.board[column] !== null;
          const enabled = canPlay && !full;
          return (
            <button
              key={index}
              type="button"
              disabled={!enabled}
              aria-label={`Row ${Math.floor(index / C4_COLS) + 1}, column ${column + 1}, ${piece(cell)}`}
              onClick={() => onMove({ kind: "place", index: column })}
              className={`aspect-square rounded-full border border-[var(--edge)] text-xl ${
                active
                  ? "bg-[var(--lamp)] text-[var(--night)]"
                  : cell === null
                    ? "bg-[var(--night)]"
                    : "bg-[var(--neon)] text-[var(--cream)]"
              } ${cell === 0 && !active ? "ring-2 ring-[var(--dress)]" : ""}`}
            >
              <span aria-hidden>{cell === null ? "" : cell === 0 ? "✦" : "●"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WordChain({ game, identity, onMove }: Props) {
  const [word, setWord] = useState("");
  const mine = game.players.indexOf(identity) as Seat | -1;
  const previous = game.words[game.words.length - 1];
  const required = previous?.word.at(-1) ?? "any letter";
  const valid = normaliseWord(word);
  const canPlay = mine === game.turn && game.status === "playing";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (valid && canPlay) onMove({ kind: "word", word: valid });
  };
  return (
    <div className="max-w-xl space-y-4" aria-label="Word chain board">
      <p className="text-sm text-[var(--mist)]">
        Start with: <strong className="text-[var(--lamp)]">{required}</strong>
      </p>
      <ol className="space-y-1 border-y border-[var(--edge)] py-3">
        {game.words.length === 0 ? (
          <li className="text-[var(--mist)]">The chain starts with you.</li>
        ) : null}
        {game.words.map((played, index) => (
          <li key={`${played.word}-${index}`} className="flex justify-between gap-4">
            <span>{played.word}</span>
            <span className="text-[var(--mist)]">{played.by === mine ? "you" : "them"}</span>
          </li>
        ))}
      </ol>
      <form className="flex flex-wrap gap-2" onSubmit={submit}>
        <label className="sr-only" htmlFor="word-chain-input">
          Your word
        </label>
        <input
          id="word-chain-input"
          value={word}
          disabled={!canPlay}
          onChange={(event) => setWord(event.target.value)}
          placeholder="Type a word"
          className="min-w-0 flex-1 border border-[var(--edge)] bg-[var(--night)] px-3 py-2 text-[var(--cream)]"
        />
        <button
          type="submit"
          disabled={!canPlay || !valid}
          className="bg-[var(--lamp)] px-4 py-2 text-[var(--night)] disabled:bg-[var(--dusk)] disabled:text-[var(--mist)]"
        >
          Play word
        </button>
      </form>
    </div>
  );
}

export function GameBoard(props: Props): ReactElement {
  if (props.game.game === "tictactoe") return <Tictactoe {...props} />;
  if (props.game.game === "connect4") return <ConnectFour {...props} />;
  return <WordChain {...props} />;
}
