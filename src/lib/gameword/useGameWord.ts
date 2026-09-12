"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";
import { newNonce, type GameId, type GameMove } from "./games";
import {
  EMPTY_SESSION,
  localMove,
  opponentOf,
  remoteMove,
  shouldAdopt,
  startSession,
  type Session,
} from "./session";

/**
 * GameWord's side of the room: holds the session, sends moves, receives them.
 *
 * All decisions are in session.ts. This only connects them to a data channel,
 * which is why it can stay short enough to read in one sitting.
 */
export function useGameWord({
  identity,
  partnerIdentity,
  send,
}: {
  identity: string;
  partnerIdentity: string | null;
  send: (message: PeerMessage) => void;
}) {
  const [session, setSession] = useState<Session>(EMPTY_SESSION);

  // Handlers read the latest session from here rather than closing over a stale
  // one. Written in an effect, never during render.
  const latest = useRef<Session>(EMPTY_SESSION);
  useEffect(() => {
    latest.current = session;
  }, [session]);

  const start = useCallback(
    (game: GameId) => {
      if (partnerIdentity === null) return;
      // Who goes first is a coin toss, made once here and carried in the
      // message, so both screens agree on the seating without deciding twice.
      const players: [string, string] =
        Math.random() < 0.5 ? [identity, partnerIdentity] : [partnerIdentity, identity];
      const message = { game, players, nonce: newNonce() };
      const next = startSession(message);
      latest.current = next;
      setSession(next);
      send({ t: "game", ...message });
    },
    [identity, partnerIdentity, send],
  );

  const move = useCallback(
    (chosen: GameMove) => {
      const current = latest.current;
      const { session: next, accepted } = localMove(current, chosen, identity);
      latest.current = next;
      setSession(next);
      if (accepted && current.nonce !== null) {
        send({ t: "move", nonce: current.nonce, move: chosen });
      }
    },
    [identity, send],
  );

  /** Back to the picker, on this screen only. */
  const leave = useCallback(() => {
    latest.current = EMPTY_SESSION;
    setSession(EMPTY_SESSION);
  }, []);

  /** Feed every inbound message through here; anything not a game is ignored. */
  const accept = useCallback(
    (message: PeerMessage) => {
      const current = latest.current;
      if (message.t === "game") {
        if (!message.players.includes(identity)) return;
        if (!shouldAdopt(current, message)) return;
        const next = startSession(message);
        latest.current = next;
        setSession(next);
        return;
      }
      if (message.t === "move") {
        const by = opponentOf(current, identity);
        if (by === null) return;
        const next = remoteMove(current, message.nonce, message.move, by);
        if (next === current) return;
        latest.current = next;
        setSession(next);
      }
    },
    [identity],
  );

  /**
   * Replays the game in progress to somebody who has just (re)joined.
   *
   * Their screen starts empty after a reconnect. Sending the start and then
   * every move rebuilds the identical board, because the board was only ever a
   * function of those moves.
   */
  const resync = useCallback(() => {
    const current = latest.current;
    if (current.game === null || current.nonce === null) return;
    send({
      t: "game",
      game: current.game.game,
      players: [current.game.players[0], current.game.players[1]],
      nonce: current.nonce,
    });
    for (const played of current.history) {
      send({ t: "move", nonce: current.nonce, move: played });
    }
  }, [send]);

  return { session, start, move, leave, accept, resync };
}
