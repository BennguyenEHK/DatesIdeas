/**
 * Free games on the web that two people can play together from two browsers.
 *
 * Hand-picked rather than searched, and checked one by one: most game sites
 * refuse to be shown inside another site (X-Frame-Options or a CSP
 * frame-ancestors rule), and an iframe that is refused is a blank box with no
 * explanation. `embed` is true only for sites that sent neither header when
 * checked (2026-09-13); everything else opens in a new tab on both screens.
 */

export interface WebGame {
  id: string;
  name: string;
  /** One line, shown on the card. */
  note: string;
  url: string;
  /** Shown inside the app. False opens a new tab. */
  embed: boolean;
  icon: string;
}

export const WEB_GAMES = [
  {
    id: "skribbl",
    name: "skribbl.io",
    note: "One draws, the other guesses. Make a private room and share the link.",
    url: "https://skribbl.io",
    embed: true,
    icon: "✏️",
  },
  {
    id: "playingcards",
    name: "PlayingCards.io",
    note: "A shared table of cards and board games, from Uno-style to chess.",
    url: "https://playingcards.io",
    embed: true,
    icon: "🃏",
  },
  {
    id: "papergames",
    name: "Papergames",
    note: "Battleship, dots and boxes, gomoku -- pen-and-paper classics.",
    url: "https://papergames.io",
    embed: true,
    icon: "📝",
  },
  {
    id: "codenames",
    name: "Codenames",
    note: "Word association, played on one shared board of spies.",
    url: "https://codenames.game",
    embed: true,
    icon: "🕵️",
  },
  {
    id: "buddyboardgames",
    name: "Buddy Board Games",
    note: "Sorry-style races, Yahtzee and more, no sign-up.",
    url: "https://buddyboardgames.com",
    embed: true,
    icon: "🎲",
  },
  {
    id: "jklm",
    name: "JKLM BombParty",
    note: "Type a word with the letters before the bomb goes off.",
    url: "https://jklm.fun",
    embed: true,
    icon: "💣",
  },
  {
    id: "garticphone",
    name: "Gartic Phone",
    note: "Telephone with drawings. Opens in a new tab.",
    url: "https://garticphone.com",
    embed: false,
    icon: "📞",
  },
  {
    id: "lichess",
    name: "Lichess",
    note: "Free chess. Challenge a friend and send the link. Opens in a new tab.",
    url: "https://lichess.org",
    embed: false,
    icon: "♟️",
  },
] as const satisfies readonly WebGame[];

export type WebGameId = (typeof WEB_GAMES)[number]["id"];

export function isWebGameId(value: unknown): value is WebGameId {
  return typeof value === "string" && WEB_GAMES.some((game) => game.id === value);
}

export function webGame(id: WebGameId): WebGame {
  const found = WEB_GAMES.find((game) => game.id === id);
  if (found === undefined) throw new Error(`unknown web game: ${id}`);
  return found;
}
