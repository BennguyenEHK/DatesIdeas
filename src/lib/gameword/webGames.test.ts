import { describe, expect, it } from "vitest";
import { isWebGameId, WEB_GAMES } from "./webGames";

describe("web games registry", () => {
  it("has unique ids and secure URLs", () => {
    const ids = WEB_GAMES.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const game of WEB_GAMES) expect(new URL(game.url).protocol).toBe("https:");
  });

  it("recognises only registered ids", () => {
    expect(isWebGameId(WEB_GAMES[0].id)).toBe(true);
    expect(isWebGameId("not-a-game")).toBe(false);
    expect(isWebGameId(null)).toBe(false);
  });
});
