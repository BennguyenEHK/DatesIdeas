import { describe, it, expect } from "vitest";
import {
  applyMove,
  isGameMove,
  newGame,
  normaliseWord,
  resolveStart,
  type GameMove,
  type GameState,
} from "./games";

const BEN = "ben";
const K = "k";

/** Plays a sequence, failing loudly if any move is refused along the way. */
function play(state: GameState, moves: [string, GameMove][]): GameState {
  return moves.reduce((current, [by, move]) => {
    const result = applyMove(current, move, by);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.state;
  }, state);
}

const place = (index: number): GameMove => ({ kind: "place", index });
const word = (w: string): GameMove => ({ kind: "word", word: w });

describe("turns", () => {
  it("refuses a move out of turn and says why", () => {
    const result = applyMove(newGame("tictactoe", [BEN, K]), place(0), K);
    expect(result).toEqual({ ok: false, reason: "It is not your turn." });
  });

  it("refuses somebody who is not playing", () => {
    const result = applyMove(newGame("tictactoe", [BEN, K]), place(0), "stranger");
    expect(result.ok).toBe(false);
  });

  it("lets either player resign at any moment, on either turn", () => {
    // Nobody should have to wait politely for their turn to concede.
    const result = applyMove(newGame("connect4", [BEN, K]), { kind: "resign" }, K);
    expect(result.ok && result.state.winner).toBe(0);
  });

  it("refuses anything once the game is over", () => {
    const over = play(newGame("tictactoe", [BEN, K]), [[BEN, { kind: "resign" }]]);
    expect(applyMove(over, place(4), K)).toEqual({ ok: false, reason: "That game is over." });
  });
});

describe("noughts and crosses", () => {
  it("finds a win and the line that made it", () => {
    const end = play(newGame("tictactoe", [BEN, K]), [
      [BEN, place(0)], [K, place(3)],
      [BEN, place(1)], [K, place(4)],
      [BEN, place(2)],
    ]);
    expect(end.status).toBe("won");
    expect(end.winner).toBe(0);
    expect(end.line).toEqual([0, 1, 2]);
  });

  it("calls a full board with no line a draw", () => {
    // X O X / X O O / O X X
    const end = play(newGame("tictactoe", [BEN, K]), [
      [BEN, place(0)], [K, place(1)], [BEN, place(2)],
      [K, place(4)], [BEN, place(3)], [K, place(5)],
      [BEN, place(7)], [K, place(6)], [BEN, place(8)],
    ]);
    expect(end.status).toBe("drawn");
    expect(end.winner).toBeNull();
  });

  it("refuses a taken square", () => {
    const state = play(newGame("tictactoe", [BEN, K]), [[BEN, place(4)]]);
    expect(applyMove(state, place(4), K)).toEqual({ ok: false, reason: "That square is taken." });
  });
});

describe("four in a row", () => {
  it("drops a disc to the lowest empty cell", () => {
    const state = play(newGame("connect4", [BEN, K]), [[BEN, place(3)], [K, place(3)]]);
    // Row 5 is the bottom; column 3 of row 5 is 38, of row 4 is 31.
    expect(state.board[38]).toBe(0);
    expect(state.board[31]).toBe(1);
  });

  it("finds a diagonal, not only the easy directions", () => {
    const end = play(newGame("connect4", [BEN, K]), [
      [BEN, place(0)],
      [K, place(1)], [BEN, place(1)],
      [K, place(2)], [BEN, place(3)], [K, place(2)], [BEN, place(2)],
      [K, place(3)], [BEN, place(4)], [K, place(3)], [BEN, place(3)],
    ]);
    expect(end.status).toBe("won");
    expect(end.winner).toBe(0);
    expect(end.line).toHaveLength(4);
  });

  it("refuses a full column", () => {
    const full = play(newGame("connect4", [BEN, K]), [
      [BEN, place(0)], [K, place(0)], [BEN, place(0)],
      [K, place(0)], [BEN, place(0)], [K, place(0)],
    ]);
    expect(applyMove(full, place(0), BEN)).toEqual({ ok: false, reason: "That column is full." });
  });
});

describe("word chain", () => {
  it("chains each word from the last letter of the one before", () => {
    const state = play(newGame("wordchain", [BEN, K]), [[BEN, word("Cinema")], [K, word("apple")]]);
    expect(state.words.map((w) => w.word)).toEqual(["cinema", "apple"]);
    const refused = applyMove(state, word("dance"), BEN);
    expect(refused).toEqual({ ok: false, reason: 'It has to start with "e".' });
  });

  it("refuses a word already played", () => {
    const state = play(newGame("wordchain", [BEN, K]), [[BEN, word("eye")], [K, word("elephant")], [BEN, word("tree")]]);
    expect(applyMove(state, word("eye"), K)).toEqual({ ok: false, reason: '"eye" has already been played.' });
  });

  it("refuses something that is not letters", () => {
    expect(applyMove(newGame("wordchain", [BEN, K]), word("r2d2"), BEN).ok).toBe(false);
    expect(normaliseWord("  Moonlight ")).toBe("moonlight");
    expect(normaliseWord("a")).toBeNull();
  });
});

describe("both screens reach the same game", () => {
  it("apply the same moves to the same board", () => {
    // No side announces a board; both compute it. Replaying the moves on a
    // second copy must reproduce the first exactly.
    const moves: [string, GameMove][] = [[BEN, place(4)], [K, place(0)], [BEN, place(8)]];
    expect(play(newGame("tictactoe", [BEN, K]), moves)).toEqual(play(newGame("tictactoe", [BEN, K]), moves));
  });

  it("settle a simultaneous start the same way on both sides", () => {
    const mine = { nonce: "b", game: "tictactoe" };
    const theirs = { nonce: "c", game: "connect4" };
    expect(resolveStart(mine, theirs)).toEqual(resolveStart(theirs, mine));
  });
});

describe("isGameMove, on what the other browser sent", () => {
  it("accepts the three shapes of move", () => {
    expect(isGameMove({ kind: "place", index: 3 })).toBe(true);
    expect(isGameMove({ kind: "word", word: "moon" })).toBe(true);
    expect(isGameMove({ kind: "resign" })).toBe(true);
  });

  it("refuses the rest, including an unbounded word", () => {
    for (const value of [null, {}, { kind: "place", index: 1.5 }, { kind: "place", index: -1 }, { kind: "word", word: "a".repeat(100) }, { kind: "cheat" }]) {
      expect(isGameMove(value)).toBe(false);
    }
  });
});
