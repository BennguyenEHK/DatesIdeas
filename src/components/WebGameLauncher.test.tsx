import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WEB_GAMES } from "@/lib/gameword/webGames";
import { WebGameLauncher } from "./WebGameLauncher";

describe("WebGameLauncher", () => {
  it("lists every game with its hosting chip and reports the selected id", () => {
    const onWebGame = vi.fn();
    render(<WebGameLauncher webGameId={null} onWebGame={onWebGame} />);
    for (const game of WEB_GAMES) {
      expect(screen.getByRole("button", { name: new RegExp(game.name) })).toBeTruthy();
      expect(screen.getAllByText(game.embed ? "Plays here" : "Opens in a new tab").length).toBe(
        WEB_GAMES.filter((candidate) => candidate.embed === game.embed).length,
      );
    }
    fireEvent.click(screen.getByRole("button", { name: new RegExp(WEB_GAMES[0].name) }));
    expect(onWebGame).toHaveBeenCalledWith(WEB_GAMES[0].id);
  });

  it("embeds an in-app game with the required frame policy", () => {
    render(<WebGameLauncher webGameId="skribbl" onWebGame={vi.fn()} />);
    const frame = screen.getByTitle("skribbl.io");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("target")).toBe("_blank");
  });

  it("does not render a frame for a game that must open separately", () => {
    render(<WebGameLauncher webGameId="lichess" onWebGame={vi.fn()} />);
    expect(screen.queryByTitle("Lichess")).toBeNull();
    expect(screen.getByRole("link", { name: "Open Lichess" })).toBeTruthy();
  });
});
