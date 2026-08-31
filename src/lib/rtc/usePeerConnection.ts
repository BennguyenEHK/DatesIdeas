"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIceServers } from "./iceServers";
import { decode, encode, type PeerMessage } from "./protocol";
import { SyncedClock } from "@/lib/sync/SyncedClock";
import { getIdentity } from "@/lib/history/identity";
import {
  useSignaling,
  type PeerInfo,
  type SignalMessage,
} from "@/lib/signaling/useSignaling";

export type ConnState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface PeerApi {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  state: ConnState;
  /** True when the selected candidate pair goes through a TURN relay. */
  relayed: boolean;
  /** False when this peer negotiated receive-only and cannot send video. */
  sending: boolean;
  rtt: number;
  mediaError: string | null;
  clock: SyncedClock | null;
  send: (m: PeerMessage) => void;
  retry: () => void;
}

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: { echoCancellation: true, noiseSuppression: true },
};

export function usePeerConnection(
  code: string,
  onMessage: (m: PeerMessage) => void,
): PeerApi {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<ConnState>("idle");
  const [relayed, setRelayed] = useState(false);
  const [rtt, setRtt] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The clock is state, not just a ref: consumers must re-render when it
  // appears, or they hold a null clock for the life of the session.
  const [clock, setClock] = useState<SyncedClock | null>(null);
  // False until getUserMedia has either resolved or been refused. Signalling
  // waits on this: a peer that announces itself before it knows what it can
  // send may be offered to, and would answer `recvonly`.
  const [mediaSettled, setMediaSettled] = useState(false);
  const [sending, setSending] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const clockRef = useRef<SyncedClock | null>(null);
  const offeredRef = useRef(false);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });
  const sendSignalRef = useRef<(m: SignalMessage) => void>(() => {});

  const send = useCallback((m: PeerMessage) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(encode(m));
  }, []);

  const wireDataChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      const clock = new SyncedClock({ send });
      clockRef.current = clock;
      setClock(clock);
      clock.startSync();
      send({
        t: "hello",
        identity: getIdentity(),
        name: localStorage.getItem("datesidea.name") ?? "Partner",
      });
    };
    dc.onmessage = (e) => {
      const msg = decode(typeof e.data === "string" ? e.data : "");
      if (!msg) return;
      // The clock owns ping/pong; everything else goes to the app.
      if (msg.t === "ping" || msg.t === "pong") {
        clockRef.current?.handleMessage(msg);
        setRtt(clockRef.current?.rtt ?? 0);
        return;
      }
      onMessageRef.current(msg);
    };
    dc.onclose = () => {
      clockRef.current?.stop();
      clockRef.current = null;
      setClock(null);
    };
  }, [send]);

  // Acquire local media once per attempt.
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia(MEDIA_CONSTRAINTS)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        setMediaError(null);
        setLocalStream(s);
        setMediaSettled(true);
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        // Join anyway: a receive-only session is better than a dead page.
        setMediaError(err.name === "NotAllowedError" ? "denied" : "unavailable");
        setLocalStream(null);
        // A refusal is still a decision — proceed receive-only rather than hang.
        setMediaSettled(true);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attempt]);

  const buildConnection = useCallback(async () => {
    const { iceServers } = await fetchIceServers();
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 4 });
    pcRef.current = pc;

    if (localStream) {
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      setSending(true);
    } else {
      setSending(false);
      // No camera: still negotiate receive-only transceivers.
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    }

    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? null);
    pc.ondatachannel = (e) => wireDataChannel(e.channel);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignalRef.current({
          kind: "ice",
          candidate: e.candidate.toJSON(),
          from: getIdentity(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          setState("connected");
          void reportRelayStatus(pc, setRelayed);
          break;
        case "disconnected":
          setState("reconnecting");
          break;
        case "failed":
          setState("failed");
          if (offeredRef.current) void restartIce(pc, sendSignalRef.current);
          break;
      }
    };
    return pc;
  }, [localStream, wireDataChannel]);

  const signaling = useSignaling(
    code,
    {
    onPeer: async (_peer: PeerInfo, iOffer: boolean) => {
      if (!iOffer || offeredRef.current) return;
      offeredRef.current = true;
      setState("connecting");
      const pc = pcRef.current ?? (await buildConnection());
      wireDataChannel(pc.createDataChannel("sync", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignalRef.current({ kind: "offer", sdp: offer.sdp!, from: getIdentity() });
    },
    onOffer: async (sdp) => {
      setState("connecting");
      const pc = pcRef.current ?? (await buildConnection());
      await pc.setRemoteDescription({ type: "offer", sdp });
      await drainIce(pc, pendingIce.current);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalRef.current({ kind: "answer", sdp: answer.sdp!, from: getIdentity() });
    },
    onAnswer: async (sdp) => {
      const pc = pcRef.current;
      if (!pc || pc.signalingState === "stable") return;
      await pc.setRemoteDescription({ type: "answer", sdp });
      await drainIce(pc, pendingIce.current);
    },
    onIce: async (candidate) => {
      const pc = pcRef.current;
      // Candidates can arrive before the remote description; buffer them.
      if (!pc?.remoteDescription) {
        pendingIce.current.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    },
    },
    // Once the media path is up the handshake is over; polling drops to a
    // slow heartbeat kept only for renegotiation.
    state === "connected",
    mediaSettled,
  );
  useEffect(() => {
    sendSignalRef.current = signaling.send;
  });

  useEffect(() => {
    return () => {
      clockRef.current?.stop();
      dcRef.current?.close();
      pcRef.current?.close();
      pcRef.current = null;
      offeredRef.current = false;
    };
  }, [code, attempt]);

  const retry = useCallback(() => {
    clockRef.current?.stop();
    dcRef.current?.close();
    pcRef.current?.close();
    pcRef.current = null;
    offeredRef.current = false;
    pendingIce.current = [];
    setRemoteStream(null);
    setState("idle");
    // Re-arm the media gate so the next attempt cannot announce itself
    // before its camera is ready.
    setMediaSettled(false);
    setSending(false);
    setAttempt((a) => a + 1);
  }, []);

  return {
    localStream,
    remoteStream,
    state,
    relayed,
    sending,
    rtt,
    mediaError,
    clock,
    send,
    retry,
  };
}

async function drainIce(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]) {
  while (queue.length) {
    const c = queue.shift()!;
    await pc.addIceCandidate(c).catch(() => {});
  }
}

async function restartIce(
  pc: RTCPeerConnection,
  sendSignal: (m: SignalMessage) => void,
) {
  const offer = await pc.createOffer({ iceRestart: true });
  await pc.setLocalDescription(offer);
  sendSignal({ kind: "offer", sdp: offer.sdp!, from: getIdentity() });
}

/** Report honestly whether media is flowing through a relay. */
async function reportRelayStatus(
  pc: RTCPeerConnection,
  setRelayed: (v: boolean) => void,
) {
  const stats = await pc.getStats();
  for (const report of stats.values()) {
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      const local = stats.get(report.localCandidateId);
      setRelayed(local?.candidateType === "relay");
      return;
    }
  }
}
