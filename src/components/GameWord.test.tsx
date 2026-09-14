import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WEB_GAMES } from "@/lib/gameword/webGames";
import { GameWord } from "./GameWord";

describe("GameWord menu", () => {
  it("offers web games and Minecraft, and no board games", () => {
    render(<GameWord />);
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
    render(<GameWord />);

    fireEvent.click(screen.getByRole("button", { name: /minecraft/i }));
    expect(screen.getByLabelText("Minecraft launcher")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    expect(screen.getByLabelText("Choose a game")).toBeTruthy();
    expect(screen.queryByLabelText("Minecraft launcher")).toBeNull();
  });
});

describe("web games on this screen only", () => {
  it("opens the chosen game here and closes back to the list", () => {
    // GameWord takes no props: there is no way for a pick to leave this screen.
    render(<GameWord />);

    fireEvent.click(screen.getByRole("button", { name: /web games/i }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(WEB_GAMES[0].name) }));
    expect(screen.getByTitle(WEB_GAMES[0].name)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTitle(WEB_GAMES[0].name)).toBeNull();
    expect(screen.getByLabelText("Web game launcher")).toBeTruthy();
  });
});
