"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentity } from "@/lib/history/identity";

export interface PeerInfo {
  identity: string;
  joinedAt: number;
}

export type SignalMessage =
  | {
      kind: "join";
      identity: string;
      /** When this peer FIRST arrived. Stable: it decides who offers. */
      joinedAt: number;
      /**
       * When this particular announcement was posted.
       *
       * Separate from joinedAt because the two answer different questions:
       * who arrived first never changes, but "is this peer still here?" has to
       * be re-asked. Optional so a peer on an older build still pairs.
       */
      sentAt?: number;
    }
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

/**
 * "closed" is a room whose day is over, and it is deliberately distinct from
 * "error". A stale link and a dropped connection look identical on screen
 * otherwise — both just sit on "waiting" — and they need opposite responses:
 * one means make a new room, the other means wait.
 */
export type SignalStatus =
  | "connecting"
  | "waiting"
  | "paired"
  | "closed"
  | "error";

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
 * How often an unpaired peer says it is still here.
 *
 * Announcing once was a single point of failure in the one situation this app
 * is actually used in: someone opens the room, waits, and the other person
 * arrives minutes later. The waiting peer's announcement goes stale after two
 * minutes and is swept from the table after fifteen -- so a peer whose laptop
 * slept and then woke had nothing left to find, and neither side ever offered
 * even though both were sitting in the room looking at each other's absence.
 *
 * Repeating it makes discovery self-healing, which is the same reason the
 * playback state is broadcast whole rather than as events.
 */
const REANNOUNCE_MS = 20_000;

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
  // Set from either the announce or a later send, so it lives outside the
  // polling effect that both of them have to be able to stop.
  const closedRef = useRef(false);

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
      })
        .then((res) => {
          // The room can run out mid-handshake: joined at 23:59, offered at
          // 00:00. Only an explicit Gone counts — a failed request is not an
          // expiry, and treating it as one would send someone off to make a
          // new room over a flicker of wifi.
          if (res.status === 410) {
            closedRef.current = true;
            setStatus("closed");
          }
        })
        .catch(() => {
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
    let lastAnnouncedAt = 0;
    closedRef.current = false;

    function handle(msg: SignalMessage) {
      switch (msg.kind) {
        case "join": {
          // Ignore our own echo and anything left over from an earlier sitting.
          if (msg.identity === identity) return;
          // Judged on when they last SPOKE, not on when they arrived. The
          // old check read joinedAt, so a peer who had been waiting patiently
          // for three minutes was discarded as debris from a previous evening.
          const announcedAt = msg.sentAt ?? msg.joinedAt;
          if (Date.now() - announcedAt > JOIN_FRESHNESS_MS) return;
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
      // Nothing can arrive in a room nobody is allowed to post to, and this
      // tab may be left open for hours.
      if (stopped || closedRef.current) return;
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
          if (!stopped && !closedRef.current && status === "connecting") {
            setStatus("waiting");
          }
        } else if (!stopped && !closedRef.current) {
          setStatus("error");
        }
      } catch {
        // Transient failure. Keep polling; the next tick usually succeeds.
      }
      if (stopped || closedRef.current) return;
      // Still alone: remind the room. This is what lets a peer that woke from
      // sleep find someone who arrived while it was out.
      if (!pairedRef.current && Date.now() - lastAnnouncedAt >= REANNOUNCE_MS) {
        void announce(false);
      }
      timer = setTimeout(poll, pairedRef.current ? POLL_IDLE_MS : POLL_PAIRING_MS);
    }

    /**
     * Say we are here. Repeated while unpaired, never after.
     *
     * `joinedAt` stays exactly as it was so the two sides keep agreeing about
     * who offers -- refreshing it would let a patient peer overtake the other
     * and leave both of them answering, or both offering.
     */
    async function announce(first: boolean) {
      lastAnnouncedAt = Date.now();
      try {
        const res = await fetch("/api/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            from: identity,
            payload: {
              kind: "join",
              identity,
              joinedAt,
              sentAt: Date.now(),
            } satisfies SignalMessage,
          }),
        });
        if (stopped) return;
        if (res.status === 410) {
          closedRef.current = true;
          setStatus("closed");
          return;
        }
        // Only the first one moves the status. A later one must not drag a
        // pairing peer back to "waiting".
        if (first) setStatus("waiting");
      } catch {
        if (first && !stopped) setStatus("error");
      }
    }

    void announce(true);

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
