"use client";

import { useCallback, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";
import type { WebGameId } from "./webGames";

/**
 * GameWord's side of the room: which web game is open, for both screens.
 *
 * Opening or closing a game sends the whole choice stamped with the shared
 * clock. The later stamp wins, and a tie goes to the larger id, so two people
 * picking at the same instant still end up in the same game.
 */
export function useGameWord({
  send,
  now = Date.now,
}: {
  send: (message: PeerMessage) => void;
  now?: () => number;
}) {
  const [webGame, setWebGame] = useState<WebGameId | null>(null);
  // Read by accept and resync, which run from message handlers outside render.
  const webGameSentAt = useRef<number | null>(null);
  const latestWebGame = useRef<WebGameId | null>(null);

  const openWebGame = useCallback(
    (id: WebGameId | null) => {
      const sentAt = now();
      latestWebGame.current = id;
      webGameSentAt.current = sentAt;
      setWebGame(id);
      send({ t: "webgame", id, sentAt });
    },
    [now, send],
  );

  /** Feed every inbound message through here; anything else is ignored. */
  const accept = useCallback((message: PeerMessage) => {
    if (message.t !== "webgame") return;
    const currentSentAt = webGameSentAt.current;
    const currentId = latestWebGame.current ?? "";
    const incomingId = message.id ?? "";
    if (
      currentSentAt !== null &&
      (message.sentAt < currentSentAt || (message.sentAt === currentSentAt && incomingId <= currentId))
    ) {
      return;
    }
    webGameSentAt.current = message.sentAt;
    latestWebGame.current = message.id;
    setWebGame(message.id);
  }, []);

  /** Tells somebody who has just (re)joined which game is open. */
  const resync = useCallback(() => {
    if (webGameSentAt.current === null) return;
    send({ t: "webgame", id: latestWebGame.current, sentAt: webGameSentAt.current });
  }, [send]);

  return { webGame, openWebGame, accept, resync };
}
