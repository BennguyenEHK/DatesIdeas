"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentity } from "@/lib/history/identity";

export interface PeerInfo {
  identity: string;
  joinedAt: number;
}

export type SignalMessage =
  | { kind: "join"; identity: string; joinedAt: number }
  | { kind: "offer"; sdp: string; from: string }
  | { kind: "answer"; sdp: string; from: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit; from: string };

/**
 * Exactly one peer must create the offer, or both stall waiting for an
 * answer. Earlier joiner wins; identical timestamps break lexicographically.
 * Asymmetric by construction.
 */
export function shouldOffer(me: PeerInfo, them: PeerInfo): boolean {
  if (me.joinedAt !== them.joinedAt) return me.joinedAt < them.joinedAt;
  return me.identity < them.identity;
}

export type SignalStatus = "connecting" | "waiting" | "paired" | "error";

export interface SignalingHandlers {
  onPeer: (peer: PeerInfo, iOffer: boolean) => void;
  onOffer: (sdp: string) => void;
  onAnswer: (sdp: string) => void;
  onIce: (candidate: RTCIceCandidateInit) => void;
}

/** Fast while the handshake is in flight; slow once it is done. */
const POLL_PAIRING_MS = 500;
const POLL_IDLE_MS = 5000;
/** A join older than this is a leftover from a previous sitting. */
const JOIN_FRESHNESS_MS = 2 * 60 * 1000;

/**
 * WebRTC signalling over a polled Postgres table.
 *
 * Neon has no realtime channel, and this handshake does not need one: it is
 * about four messages over a few seconds, after which every byte travels
 * peer-to-peer and this hook goes quiet. Polling drops to a slow heartbeat
 * once paired, which is only kept at all so an ICE restart can be negotiated
 * if the network drops mid-call.
 */
export function useSignaling(
  code: string,
  handlers: SignalingHandlers,
  paired: boolean,
  mediaSettled: boolean,
) {
  const [status, setStatus] = useState<SignalStatus>("connecting");
  const handlersRef = useRef(handlers);
  const cursorRef = useRef(0);
  const identityRef = useRef<string | null>(null);
  const seenPeerRef = useRef<string | null>(null);
  const pairedRef = useRef(paired);

  useEffect(() => {
    handlersRef.current = handlers;
    pairedRef.current = paired;
  });

  const send = useCallback(
    (msg: SignalMessage) => {
      const from = identityRef.current;
      if (!from) return;
      void fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, from, payload: msg }),
        keepalive: true,
      }).catch(() => {
        /* a dropped signal is retried by the peer's next poll */
      });
    },
    [code],
  );

  useEffect(() => {
    // Do not announce until we know what we can send.
    //
    // Announcing early is what caused one-way video: the other peer offers
    // immediately, and the offer is answered before getUserMedia resolves, so
    // the answerer negotiates `recvonly` transceivers and can never send —
    // even once its camera appears, because the connection is already built.
    // "Settled" includes a denied camera; that is a legitimate receive-only
    // session, and the point is only that the decision has been made.
    if (!mediaSettled) return;

    const identity = getIdentity();
    const joinedAt = Date.now();
    const me: PeerInfo = { identity, joinedAt };
    identityRef.current = identity;
    cursorRef.current = 0;
    seenPeerRef.current = null;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    function handle(msg: SignalMessage) {
      switch (msg.kind) {
        case "join": {
          // Ignore our own echo and anything left over from an earlier sitting.
          if (msg.identity === identity) return;
          if (Date.now() - msg.joinedAt > JOIN_FRESHNESS_MS) return;
          // Both peers see each other's join row, so guard against acting twice.
          if (seenPeerRef.current === msg.identity) return;
          seenPeerRef.current = msg.identity;

          const them = { identity: msg.identity, joinedAt: msg.joinedAt };
          setStatus("paired");
          handlersRef.current.onPeer(them, shouldOffer(me, them));
          break;
        }
        case "offer":
          handlersRef.current.onOffer(msg.sdp);
          break;
        case "answer":
          handlersRef.current.onAnswer(msg.sdp);
          break;
        case "ice":
          handlersRef.current.onIce(msg.candidate);
          break;
      }
    }

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch(
          `/api/signal?code=${encodeURIComponent(code)}` +
            `&from=${encodeURIComponent(identity)}&after=${cursorRef.current}`,
        );
        if (res.ok) {
          const body = (await res.json()) as {
            signals: SignalMessage[];
            cursor: number;
          };
          cursorRef.current = body.cursor;
          for (const msg of body.signals) handle(msg);
          if (!stopped && status === "connecting") setStatus("waiting");
        } else if (!stopped) {
          setStatus("error");
        }
      } catch {
        // Transient failure. Keep polling; the next tick usually succeeds.
      }
      if (stopped) return;
      timer = setTimeout(poll, pairedRef.current ? POLL_IDLE_MS : POLL_PAIRING_MS);
    }

    // Announce ourselves, then start listening for the other side.
    void fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        from: identity,
        payload: { kind: "join", identity, joinedAt } satisfies SignalMessage,
      }),
    })
      .then(() => setStatus("waiting"))
      .catch(() => setStatus("error"));

    void poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `status` is read but must not restart the loop; the poll re-reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, mediaSettled]);

  return { send, status };
}
