/**
 * GameWord: small two-player games played across the call.
 *
 * Every rule lives here as a pure reducer, and both browsers run the same one
 * over the same moves. Nothing is decided by one side and announced to the
 * other: each side applies each move itself and reaches the same board. That is
 * what makes a disagreement impossible rather than merely unlikely, and it is
 * why a move carries only what the player chose -- a cell, a column, a word --
 * and never the resulting board.
 *
 * Players are identities (the device ids the room already exchanges in its
 * "hello"), so "whose turn" is a fact both sides can check rather than a label
 * each side keeps separately.
 */

export const GAME_IDS = ["tictactoe", "connect4", "wordchain"] as const;
export type GameId = (typeof GAME_IDS)[number];

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && (GAME_IDS as readonly string[]).includes(value);
}

export const GAME_LABELS: Record<GameId, string> = {
  tictactoe: "Noughts and crosses",
  connect4: "Four in a row",
  wordchain: "Word chain",
};

export type Seat = 0 | 1;

export type GameMove =
  /** A cell in noughts and crosses, or a column in four in a row. */
  | { kind: "place"; index: number }
  | { kind: "word"; word: string }
  | { kind: "resign" };

export interface PlayedWord {
  word: string;
  by: Seat;
}

export interface GameState {
  game: GameId;
  /** [first player, second player], by identity. */
  players: readonly [string, string];
  turn: Seat;
  /** Noughts and crosses: 9 cells. Four in a row: 42, row-major, row 0 at the top. */
  board: readonly (Seat | null)[];
  words: readonly PlayedWord[];
  status: "playing" | "won" | "drawn";
  winner: Seat | null;
  /** The cells that won, so the board can light them. */
  line: readonly number[] | null;
  moves: number;
}

export type MoveResult = { ok: true; state: GameState } | { ok: false; reason: string };

export const C4_ROWS = 6;
export const C4_COLS = 7;
export const WORD_MIN = 2;
export const WORD_MAX = 24;

export function newGame(game: GameId, players: readonly [string, string]): GameState {
  const size = game === "tictactoe" ? 9 : game === "connect4" ? C4_ROWS * C4_COLS : 0;
  return {
    game,
    players,
    turn: 0,
    board: Array.from({ length: size }, () => null),
    words: [],
    status: "playing",
    winner: null,
    line: null,
    moves: 0,
  };
}

export function seatOf(state: GameState, identity: string): Seat | null {
  if (state.players[0] === identity) return 0;
  if (state.players[1] === identity) return 1;
  return null;
}

const TTT_LINES: readonly (readonly number[])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function tictactoeWinner(board: readonly (Seat | null)[]): readonly number[] | null {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

/** The four in a row through one just-dropped disc, or null. */
function connect4Line(board: readonly (Seat | null)[], placed: number): readonly number[] | null {
  const seat = board[placed];
  if (seat === null) return null;
  const row = Math.floor(placed / C4_COLS);
  const col = placed % C4_COLS;

  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const cells = [placed];
    for (const direction of [1, -1]) {
      let r = row + dr * direction;
      let c = col + dc * direction;
      while (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS && board[r * C4_COLS + c] === seat) {
        cells.push(r * C4_COLS + c);
        r += dr * direction;
        c += dc * direction;
      }
    }
    if (cells.length >= 4) return cells.sort((x, y) => x - y);
  }
  return null;
}

/** Lower-case, trimmed, and letters only -- or null when it is not a word at all. */
export function normaliseWord(raw: string): string | null {
  const word = raw.trim().toLowerCase();
  if (word.length < WORD_MIN || word.length > WORD_MAX) return null;
  return /^[a-z]+$/.test(word) ? word : null;
}

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/**
 * Applies a move by a player. Returns the reason when the move is refused, so
 * the person who tried it can be told exactly why rather than seeing nothing.
 */
export function applyMove(state: GameState, move: GameMove, by: string): MoveResult {
  if (state.status !== "playing") return { ok: false, reason: "That game is over." };

  const seat = seatOf(state, by);
  if (seat === null) return { ok: false, reason: "You are not playing this one." };

  // Either player may resign at any moment, including on the other's turn --
  // nobody should have to wait politely to concede.
  if (move.kind === "resign") {
    return {
      ok: true,
      state: { ...state, status: "won", winner: other(seat), line: null, moves: state.moves + 1 },
    };
  }

  if (seat !== state.turn) return { ok: false, reason: "It is not your turn." };

  if (state.game === "tictactoe") {
    if (move.kind !== "place") return { ok: false, reason: "Pick a square." };
    if (!Number.isInteger(move.index) || move.index < 0 || move.index > 8) {
      return { ok: false, reason: "That square is not on the board." };
    }
    if (state.board[move.index] !== null) return { ok: false, reason: "That square is taken." };

    const board = state.board.slice();
    board[move.index] = seat;
    const line = tictactoeWinner(board);
    const full = board.every((cell) => cell !== null);
    return {
      ok: true,
      state: {
        ...state,
        board,
        turn: other(seat),
        status: line !== null ? "won" : full ? "drawn" : "playing",
        winner: line !== null ? seat : null,
        line,
        moves: state.moves + 1,
      },
    };
  }

  if (state.game === "connect4") {
    if (move.kind !== "place") return { ok: false, reason: "Pick a column." };
    if (!Number.isInteger(move.index) || move.index < 0 || move.index >= C4_COLS) {
      return { ok: false, reason: "That column is not on the board." };
    }

    // The disc falls to the lowest empty cell in the column.
    let placed = -1;
    for (let row = C4_ROWS - 1; row >= 0; row -= 1) {
      const cell = row * C4_COLS + move.index;
      if (state.board[cell] === null) {
        placed = cell;
        break;
      }
    }
    if (placed === -1) return { ok: false, reason: "That column is full." };

    const board = state.board.slice();
    board[placed] = seat;
    const line = connect4Line(board, placed);
    const full = board.every((cell) => cell !== null);
    return {
      ok: true,
      state: {
        ...state,
        board,
        turn: other(seat),
        status: line !== null ? "won" : full ? "drawn" : "playing",
        winner: line !== null ? seat : null,
        line,
        moves: state.moves + 1,
      },
    };
  }

  // Word chain: each word starts with the last letter of the one before, and no
  // word may be played twice. It ends when somebody cannot think of one and
  // resigns -- there is no dictionary, on purpose. Arguing about whether
  // something counts as a word is half of what the game is for.
  if (move.kind !== "word") return { ok: false, reason: "Type a word." };
  const word = normaliseWord(move.word);
  if (word === null) {
    return { ok: false, reason: `A word is ${WORD_MIN} to ${WORD_MAX} letters, and only letters.` };
  }
  const previous = state.words[state.words.length - 1];
  if (previous !== undefined) {
    const needed = previous.word[previous.word.length - 1];
    if (word[0] !== needed) return { ok: false, reason: `It has to start with "${needed}".` };
  }
  if (state.words.some((played) => played.word === word)) {
    return { ok: false, reason: `"${word}" has already been played.` };
  }
  return {
    ok: true,
    state: {
      ...state,
      words: [...state.words, { word, by: seat }],
      turn: other(seat),
      moves: state.moves + 1,
    },
  };
}

/**
 * When both people press "start" at the same instant, both screens must pick the
 * same game. The larger nonce wins, which is arbitrary and, more importantly,
 * the same answer on both sides.
 */
export function resolveStart<T extends { nonce: string }>(mine: T, theirs: T): T {
  return theirs.nonce > mine.nonce ? theirs : mine;
}

/** A game id, random enough to separate one game from the next. */
export function newNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function isGameMove(value: unknown): value is GameMove {
  if (typeof value !== "object" || value === null) return false;
  const move = value as Record<string, unknown>;
  switch (move.kind) {
    case "place":
      return typeof move.index === "number" && Number.isInteger(move.index) && move.index >= 0 && move.index < 64;
    case "word":
      // Bounded here as well as in the rules: this runs on what the other
      // browser sent, and an unbounded string is a way to hang the reducer.
      return typeof move.word === "string" && move.word.length <= 64;
    case "resign":
      return true;
    default:
      return false;
  }
}
