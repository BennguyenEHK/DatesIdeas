import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GameBoard } from "./GameBoard";
import { applyMove, newGame, type GameMove, type GameState } from "@/lib/gameword/games";

const BEN = "ben";
const K = "k";

/** Builds a real word chain through the real rules, never a hand-written board. */
function chain(words: [string, string][]): GameState {
  return words.reduce((state, [by, word]) => {
    const result = applyMove(state, { kind: "word", word }, by);
    if (!result.ok) throw new Error(result.reason);
    return result.state;
  }, newGame("wordchain", [BEN, K]));
}

function submitWord(container: HTMLElement, word: string) {
  fireEvent.change(screen.getByPlaceholderText("Type a word"), { target: { value: word } });
  const form = container.querySelector("form");
  if (form === null) throw new Error("the word chain has no form");
  fireEvent.submit(form);
}

afterEach(cleanup);

describe("word chain board", () => {
  it("sends the word the person typed", () => {
    const onMove = vi.fn<(move: GameMove) => void>();
    const { container } = render(<GameBoard game={newGame("wordchain", [BEN, K])} identity={BEN} onMove={onMove} />);

    submitWord(container, "moonlight");

    expect(onMove).toHaveBeenCalledWith({ kind: "word", word: "moonlight" });
  });

  it("shows the letter the next word has to start with", () => {
    render(<GameBoard game={chain([[BEN, "cinema"]])} identity={K} onMove={vi.fn()} />);
    expect(screen.getByText("a")).toBeTruthy();
  });

  it("attributes each played word from this person's point of view", () => {
    render(<GameBoard game={chain([[BEN, "cinema"], [K, "apple"]])} identity={BEN} onMove={vi.fn()} />);
    const board = screen.getByLabelText("Word chain board");
    expect(board.textContent).toContain("cinema");
    expect(board.textContent).toContain("apple");
    expect(board.textContent).toContain("you");
    expect(board.textContent).toContain("them");
  });

  it("sends nothing on the other person's turn", () => {
    // After Ben's word it is K's turn, so Ben's screen must not be able to play.
    const onMove = vi.fn<(move: GameMove) => void>();
    const { container } = render(<GameBoard game={chain([[BEN, "cinema"]])} identity={BEN} onMove={onMove} />);

    submitWord(container, "apple");

    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not send something that is not a word", () => {
    const onMove = vi.fn<(move: GameMove) => void>();
    const { container } = render(<GameBoard game={newGame("wordchain", [BEN, K])} identity={BEN} onMove={onMove} />);

    submitWord(container, "r2d2");

    expect(onMove).not.toHaveBeenCalled();
  });
});
