"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** How long an unanswered request keeps "Getting you in…" on screen. */
export const JOIN_WAIT_MS = 20_000;

export const JOIN_FAILED = "Could not join the album";

type Phase = "idle" | "asking" | "claiming" | "unanswered" | "failed";

export interface AlbumJoin {
  /** True from the request going out until the claim resolves or the wait runs out. */
  joining: boolean;
  /** Why the last attempt failed, in one line, or null. */
  error: string | null;
  /**
   * The request went out and nobody answered in time. Neither device is on an
   * album, so there is nobody to be invited by.
   */
  unanswered: boolean;
  /** Asks the other screen again, after a failure. */
  retry: () => void;
  /** The device that has just joined this album from the other screen, for Undo. */
  joinedKeyId: string | null;
  dismissJoined: () => void;
  /** Takes that device's key away again. */
  undoJoined: () => Promise<void>;
  /** Feed every hello and album-join message here. */
  accept: (message: PeerMessage) => void;
}

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Puts the other device on this album, or this device on theirs, when the two
 * of you meet in a room.
 *
 * Both screens run the same code. The one without a season ticket asks on
 * every hello; the one with a ticket mints a one-time invitation and sends it
 * back over the data channel; the asker redeems it for a key of its own and
 * says so, which is what shows the "new device" line with Undo on the inviting
 * screen. If both are paired nothing is sent, and if neither is, the request
 * goes unanswered and the wait runs out.
 *
 * The request is tied to hello rather than to the connection state alone: the
 * connection reports "connected" a moment before the data channel opens, and
 * the channel drops anything sent while it is not open. Hello is proof that it
 * is. `connected` still gates it, so a hello from a connection that has since
 * dropped asks nobody.
 */
export function useAlbumJoin({
  paired,
  known,
  send,
  connected,
  onJoined,
}: {
  paired: boolean;
  known: boolean;
  send: (message: PeerMessage) => void;
  connected: boolean;
  onJoined: () => void;
}): AlbumJoin {
  const [phase, setPhase] = useState<Phase>("idle");
  const [joinedKeyId, setJoinedKeyId] = useState<string | null>(null);
  // Counts hellos. Each one is a fresh connection that has heard nothing yet.
  const [greetings, setGreetings] = useState(0);

  // Read from message handlers and timers, outside render.
  const latestPaired = useRef(paired);
  const askedFor = useRef(0);
  const inviting = useRef(false);
  const claiming = useRef(false);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestPaired.current = paired;
  }, [paired]);

  const stopWaiting = useCallback(() => {
    if (waitTimer.current !== null) clearTimeout(waitTimer.current);
    waitTimer.current = null;
  }, []);

  useEffect(() => stopWaiting, [stopWaiting]);

  const ask = useCallback(() => {
    send({ t: "album-join-request" });
    setPhase("asking");
    stopWaiting();
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      setPhase((current) => (current === "asking" ? "unanswered" : current));
    }, JOIN_WAIT_MS);
  }, [send, stopWaiting]);

  useEffect(() => {
    if (!connected || !known || paired || greetings === askedFor.current) return;
    askedFor.current = greetings;
    // Queued rather than called here: asking sets state, and an effect body
    // must not. The hello that triggered this has already been handled.
    void Promise.resolve().then(ask);
  }, [ask, connected, greetings, known, paired]);

  const invite = useCallback(async () => {
    if (inviting.current) return;
    inviting.current = true;
    try {
      const response = await post("/api/pair/invite");
      if (!response.ok) return;
      const body = (await response.json()) as { code: string; expiresAt: number };
      send({ t: "album-join", code: body.code, expiresAt: body.expiresAt });
    } catch {
      // The other screen's wait runs out and it offers Try again.
    } finally {
      inviting.current = false;
    }
  }, [send]);

  const claim = useCallback(
    async (code: string) => {
      if (claiming.current) return;
      claiming.current = true;
      stopWaiting();
      setPhase("claiming");
      try {
        const response = await post("/api/pair/claim", { code });
        if (!response.ok) throw new Error("claim refused");
        const body = (await response.json()) as { keyId: string };
        // The cookie is already set, so the album and calendar can load now.
        latestPaired.current = true;
        setPhase("idle");
        onJoined();
        send({ t: "album-joined", keyId: body.keyId });
      } catch {
        setPhase("failed");
      } finally {
        claiming.current = false;
      }
    },
    [onJoined, send, stopWaiting],
  );

  const accept = useCallback(
    (message: PeerMessage) => {
      if (message.t === "hello") {
        setGreetings((count) => count + 1);
      } else if (message.t === "album-join-request") {
        if (latestPaired.current) void invite();
      } else if (message.t === "album-join") {
        if (!latestPaired.current) void claim(message.code);
      } else if (message.t === "album-joined") {
        setJoinedKeyId(message.keyId);
      }
    },
    [claim, invite],
  );

  const retry = useCallback(() => {
    if (latestPaired.current) return;
    ask();
  }, [ask]);

  const dismissJoined = useCallback(() => setJoinedKeyId(null), []);

  const undoJoined = useCallback(async () => {
    if (joinedKeyId === null) return;
    try {
      const response = await post("/api/pair/revoke", { keyId: joinedKeyId });
      // A failed undo keeps the line up so it can be pressed again: the device
      // is still on the album, and hiding that would be the one thing Undo is
      // there to prevent.
      if (response.ok) setJoinedKeyId(null);
    } catch {
      // Same: the line stays.
    }
  }, [joinedKeyId]);

  return {
    joining: !paired && (phase === "asking" || phase === "claiming"),
    error: !paired && phase === "failed" ? JOIN_FAILED : null,
    unanswered: !paired && phase === "unanswered",
    retry,
    joinedKeyId,
    dismissJoined,
    undoJoined,
    accept,
  };
}
