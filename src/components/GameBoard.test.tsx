import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyMove, newGame, type GameState } from "@/lib/gameword/games";
import { GameBoard } from "./GameBoard";

function move(state: GameState, index: number, identity: string): GameState {
  const result = applyMove(state, { kind: "place", index }, identity);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("GameBoard", () => {
  it("emits a square move and never emits from a taken cell", () => {
    const onMove = vi.fn();
    const game = newGame("tictactoe", ["me", "them"]);
    const view = render(<GameBoard game={game} identity="me" onMove={onMove} />);
    fireEvent.click(screen.getByLabelText("Square 1, Empty"));
    expect(onMove).toHaveBeenCalledWith({ kind: "place", index: 0 });
    view.rerender(<GameBoard game={move(game, 0, "me")} identity="them" onMove={onMove} />);
    fireEvent.click(screen.getByLabelText("Square 1, Cross"));
    expect(onMove).toHaveBeenCalledTimes(1);
  });
  it("does not allow a turn held by the other person", () => {
    const onMove = vi.fn();
    render(<GameBoard game={move(newGame("tictactoe", ["me", "them"]), 0, "me")} identity="me" onMove={onMove} />);
    expect((screen.getByLabelText("Square 2, Empty") as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not emit for a full four in a row column", () => {
    let game = newGame("connect4", ["me", "them"]);
    for (const [by, col] of [["me", 0], ["them", 0], ["me", 0], ["them", 0], ["me", 0], ["them", 0]] as const) game = move(game, col, by);
    const onMove = vi.fn();
    render(<GameBoard game={game} identity="me" onMove={onMove} />);
    fireEvent.click(screen.getByLabelText("Drop target, column 1, full"));
    expect(onMove).not.toHaveBeenCalled();
  });
});
