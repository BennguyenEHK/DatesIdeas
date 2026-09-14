import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WEB_GAMES } from "@/lib/gameword/webGames";
import { GameWord } from "./GameWord";

describe("GameWord menu", () => {
  it("offers web games and Minecraft, and no board games", () => {
    render(<GameWord webGame={null} onWebGame={vi.fn()} />);
    const menu = screen.getByLabelText("Choose a game");
    expect(menu.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /web games/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /minecraft/i })).toBeTruthy();
    for (const retired of [/noughts and crosses/i, /four in a row/i, /word chain/i]) {
      expect(screen.queryByText(retired)).toBeNull();
    }
  });
});

describe("the Minecraft launcher inside GameWord", () => {
  it("comes back to the game menu instead of trapping you in the launcher", () => {
    render(<GameWord webGame={null} onWebGame={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /minecraft/i }));
    expect(screen.getByLabelText("Minecraft launcher")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    expect(screen.getByLabelText("Choose a game")).toBeTruthy();
    expect(screen.queryByLabelText("Minecraft launcher")).toBeNull();
  });
});

describe("the web game launcher inside GameWord", () => {
  it("opens the chosen game for both screens", () => {
    const onWebGame = vi.fn();
    render(<GameWord webGame={null} onWebGame={onWebGame} />);

    fireEvent.click(screen.getByRole("button", { name: /web games/i }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(WEB_GAMES[0].name) }));

    expect(onWebGame).toHaveBeenCalledWith(WEB_GAMES[0].id);
  });

  it("shows a game the other person opened, even from the menu", () => {
    render(<GameWord webGame="skribbl" onWebGame={vi.fn()} />);
    expect(screen.getByTitle("skribbl.io")).toBeTruthy();
    expect(screen.queryByLabelText("Choose a game")).toBeNull();
  });
});
