"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";
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

export function useSignaling(code: string, handlers: SignalingHandlers) {
  const [status, setStatus] = useState<SignalStatus>("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlersRef = useRef(handlers);
  // Refs are written in an effect, never during render.
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const identity = getIdentity();
    const joinedAt = Date.now();
    const me: PeerInfo = { identity, joinedAt };

    const channel = getSupabase().channel(`room:${code}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      const msg = payload as SignalMessage;
      if ("from" in msg && msg.from === identity) return;

      switch (msg.kind) {
        case "join": {
          const them = { identity: msg.identity, joinedAt: msg.joinedAt };
          setStatus("paired");
          // Re-announce so a peer who joined first learns about us too.
          channel.send({
            type: "broadcast",
            event: "signal",
            payload: { kind: "join", identity, joinedAt } satisfies SignalMessage,
          });
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
    });

    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        setStatus("waiting");
        channel.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "join", identity, joinedAt } satisfies SignalMessage,
        });
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        setStatus("error");
      }
    });

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [code]);

  // Stable identity: callers hold onto this across renders.
  const send = useCallback((msg: SignalMessage) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload: msg });
  }, []);

  return { send, status };
}
