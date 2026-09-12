import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyMove, newGame, type GameState } from "@/lib/gameword/games";
import { GameWord } from "./GameWord";

function play(state: GameState, index: number, identity: string): GameState {
  const result = applyMove(state, { kind: "place", index }, identity);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const callbacks = () => ({ onStart: vi.fn(), onMove: vi.fn(), onLeave: vi.fn() });

describe("GameWord", () => {
  it("flips the turn language from this person's view", () => {
    const props = callbacks();
    const game = newGame("tictactoe", ["me", "them"]);
    const view = render(<GameWord {...props} identity="me" partnerIdentity="them" game={game} error={null} />);
    expect(screen.getByText("Your move")).toBeTruthy();
    view.rerender(<GameWord {...props} identity="me" partnerIdentity="them" game={play(game, 0, "me")} error={null} />);
    expect(screen.getByText("Their move")).toBeTruthy();
  });
  it("disables starts until a partner joins", () => {
    const props = callbacks();
    render(<GameWord {...props} identity="me" partnerIdentity={null} game={null} error={null} />);
    expect((screen.getByRole("button", { name: "Noughts and crosses" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/other person joins/)).toBeTruthy();
  });
  it("lights a winning line and names the winner", () => {
    const props = callbacks();
    let game = newGame("tictactoe", ["me", "them"]);
    for (const [by, index] of [["me", 0], ["them", 3], ["me", 1], ["them", 4], ["me", 2]] as const) game = play(game, index, by);
    render(<GameWord {...props} identity="me" partnerIdentity="them" game={game} error={null} />);
    expect(screen.getByText("You won")).toBeTruthy();
    expect(screen.getByLabelText("Square 1, Cross").className).toContain("bg-[var(--lamp)]");
  });
  it("requires a second press to concede", () => {
    const props = callbacks();
    render(<GameWord {...props} identity="me" partnerIdentity="them" game={newGame("tictactoe", ["me", "them"])} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Concede game" }));
    expect(props.onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, concede" }));
    expect(props.onMove).toHaveBeenCalledWith({ kind: "resign" });
  });
});

describe("the Minecraft launcher inside GameWord", () => {
  it("comes back to the game menu instead of trapping you in the launcher", () => {
    const props = callbacks();
    render(<GameWord {...props} identity="me" partnerIdentity="them" game={null} error={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Minecraft launcher" }));
    expect(screen.getByLabelText("Minecraft launcher")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    expect(screen.getByLabelText("Choose a game")).toBeTruthy();
    expect(screen.queryByLabelText("Minecraft launcher")).toBeNull();
  });
});
