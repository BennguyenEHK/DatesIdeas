import {
  applyMove,
  newGame,
  resolveStart,
  type GameId,
  type GameMove,
  type GameState,
} from "./games";

/**
 * One side's view of the game being played across the call.
 *
 * Pure, like games.ts, so the parts that decide whether two screens agree can be
 * tested without React or a data channel. The hook in useGameWord.ts is a thin
 * shell around this that sends and receives.
 */

export interface Session {
  game: GameState | null;
  /** Names this particular game, so a move from the one before is ignored. */
  nonce: string | null;
  /** Every move so far, in order. Replayed to somebody who arrives mid-game. */
  history: readonly GameMove[];
  /** The last refused move's reason, shown to whoever tried it. */
  error: string | null;
}

export const EMPTY_SESSION: Session = { game: null, nonce: null, history: [], error: null };

export interface StartMessage {
  game: GameId;
  players: readonly [string, string];
  nonce: string;
}

export function startSession(start: StartMessage): Session {
  return { game: newGame(start.game, start.players), nonce: start.nonce, history: [], error: null };
}

/**
 * Whether a game the other person started should replace what this side has.
 *
 * Yes when there is nothing here, or the game here is already under way or over
 * -- they have pressed "play again" or picked something new. When BOTH sides
 * pressed start before either heard from the other, both games are fresh, and
 * resolveStart picks the same one on both screens, so each side keeps its own
 * or adopts the other's and they end up agreeing.
 */
export function shouldAdopt(current: Session, incoming: StartMessage): boolean {
  if (current.game === null || current.nonce === null) return true;
  if (current.nonce === incoming.nonce) return false;
  if (current.game.moves > 0 || current.game.status !== "playing") return true;
  return resolveStart({ nonce: current.nonce }, { nonce: incoming.nonce }).nonce === incoming.nonce;
}

/** A move this person made, already checked: records it or records why not. */
export function localMove(session: Session, move: GameMove, identity: string): {
  session: Session;
  accepted: boolean;
} {
  if (session.game === null) return { session, accepted: false };
  const result = applyMove(session.game, move, identity);
  if (!result.ok) return { session: { ...session, error: result.reason }, accepted: false };
  return {
    session: { ...session, game: result.state, history: [...session.history, move], error: null },
    accepted: true,
  };
}

/**
 * A move the other person made.
 *
 * Ignored, never shown as an error, when it belongs to another game or the rules
 * refuse it. The other side ran the same rules before sending, so a refusal here
 * means a stale or duplicated message rather than something anybody did wrong.
 */
export function remoteMove(session: Session, nonce: string, move: GameMove, by: string): Session {
  if (session.game === null || session.nonce !== nonce) return session;
  const result = applyMove(session.game, move, by);
  if (!result.ok) return session;
  return { ...session, game: result.state, history: [...session.history, move] };
}

/** The other player's identity in this game, from this side's point of view. */
export function opponentOf(session: Session, identity: string): string | null {
  if (session.game === null) return null;
  const [first, second] = session.game.players;
  if (first === identity) return second;
  if (second === identity) return first;
  return null;
}
