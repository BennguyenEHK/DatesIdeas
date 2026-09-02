"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIceServers } from "./iceServers";
import { decode, encode, type PeerMessage } from "./protocol";
import { SyncedClock } from "@/lib/sync/SyncedClock";
import { selectPath, type PathInfo } from "./path";
import { preferMusicAudio } from "./sdp";
import { readJitter, jitterDelayMs, type JitterSample } from "./videoStats";
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
  /**
   * The room's day is over, so signalling refuses to carry anything more.
   * Kept apart from a failed connection: there is nothing to retry here, and
   * a page that says "reconnecting" forever is the wrong thing to show.
   */
  roomClosed: boolean;
  state: ConnState;
  /** The route actually carrying the call, and what the browser says it costs. */
  path: PathInfo | null;
  /** False when this peer negotiated receive-only and cannot send video. */
  sending: boolean;
  /**
   * Milliseconds the average video frame spends waiting in the jitter buffer.
   * Invisible to `rtt`, which times a text message and never touches it, yet
   * on a long link it can cost more than crossing the ocean.
   */
  jitterMs: number | null;
  rtt: number;
  mediaError: string | null;
  clock: SyncedClock | null;
  send: (m: PeerMessage) => void;
  retry: () => void;
}

/** ICE can migrate mid-call, so the route is re-checked rather than sampled once. */
const PATH_POLL_MS = 3000;
/**
 * How long to keep signalling fast after the first route works, if ICE never
 * says it has finished. Without a cap a browser that stays at "connected"
 * would poll twice a second for the whole call.
 */
const ICE_SETTLE_GRACE_MS = 15_000;

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  // Two channels asked for so a stereo-capable input is not collapsed before
  // it reaches the encoder. Most microphones are mono and will ignore it.
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 2 },
};

export function usePeerConnection(
  code: string,
  onMessage: (m: PeerMessage) => void,
): PeerApi {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<ConnState>("idle");
  const [path, setPath] = useState<PathInfo | null>(null);
  const [jitterMs, setJitterMs] = useState<number | null>(null);
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
  // "connected" means one route works, NOT that ICE has stopped looking for a
  // better one. Slowing the candidate exchange at that point can strand the
  // call on a relay it would otherwise have escaped.
  const [iceSettled, setIceSettled] = useState(false);
  const [sending, setSending] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const jitterRef = useRef<JitterSample | null>(null);
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
      for (const track of localStream.getTracks()) {
        // A face talking, not a screen full of text: tell the encoder to keep
        // motion smooth rather than hoarding bits for still detail.
        if (track.kind === "video") track.contentHint = "motion";
        pc.addTrack(track, localStream);
      }
      setSending(true);
    } else {
      setSending(false);
      // No camera: still negotiate receive-only transceivers.
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    }

    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0] ?? null);
      shortenJitterBuffer(e.receiver);
    };
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
    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState;
      // "completed" is the real finish line: every check is done and the final
      // pair is nominated. Only then is there nothing left to exchange.
      if (ice === "completed" || ice === "failed" || ice === "closed") {
        setIceSettled(true);
      }
    };
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          setState("connected");
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
      // Rewritten before it is set, because there is no API for these: the
      // browser negotiates audio for a phone call and this is the only place
      // to ask it for music instead.
      const offerSdp = preferMusicAudio(offer.sdp!);
      await pc.setLocalDescription({ type: "offer", sdp: offerSdp });
      sendSignalRef.current({ kind: "offer", sdp: offerSdp, from: getIdentity() });
    },
    onOffer: async (sdp) => {
      setState("connecting");
      const pc = pcRef.current ?? (await buildConnection());
      await pc.setRemoteDescription({ type: "offer", sdp });
      await drainIce(pc, pendingIce.current);
      const answer = await pc.createAnswer();
      const answerSdp = preferMusicAudio(answer.sdp!);
      await pc.setLocalDescription({ type: "answer", sdp: answerSdp });
      sendSignalRef.current({ kind: "answer", sdp: answerSdp, from: getIdentity() });
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
    // Not `state === "connected"`: ICE keeps hunting for a better route after
    // the first one succeeds, and a late-arriving direct candidate must not be
    // held back by a five-second poll. Slow down only once ICE is finished.
    iceSettled,
    mediaSettled,
  );
  useEffect(() => {
    sendSignalRef.current = signaling.send;
  });

  useEffect(() => {
    if (state !== "connected" || iceSettled) return;
    // Safety net for browsers that never report "completed".
    const id = setTimeout(() => setIceSettled(true), ICE_SETTLE_GRACE_MS);
    return () => clearTimeout(id);
  }, [state, iceSettled]);

  useEffect(() => {
    if (state !== "connected") return;
    let cancelled = false;

    const sample = async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const stats = await pc.getStats();
      if (cancelled) return;
      setPath(selectPath(stats));

      const sample = readJitter(stats);
      if (sample) {
        setJitterMs(jitterDelayMs(jitterRef.current, sample));
        jitterRef.current = sample;
      }
    };

    void sample();
    const id = setInterval(() => void sample(), PATH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state]);

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
    setPath(null);
    setJitterMs(null);
    jitterRef.current = null;
    setIceSettled(false);
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
    // The room's day is over. Distinct from a failed connection: there is
    // nothing here to retry, so the page says so instead of waiting.
    roomClosed: signaling.status === "closed",
    state,
    path,
    sending,
    jitterMs,
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
  const sdp = preferMusicAudio(offer.sdp!);
  await pc.setLocalDescription({ type: "offer", sdp });
  sendSignal({ kind: "offer", sdp, from: getIdentity() });
}

/**
 * Ask for the shortest jitter buffer the browser will give us.
 *
 * The buffer trades delay for smoothness, and the default leans hard towards
 * smoothness — often 50-200ms of held-back video. Zero is a request, not an
 * order: the browser still grows the buffer when the network turns rough,
 * which is exactly the safety net worth keeping. Chrome 124+; older browsers
 * simply keep their default.
 */
function shortenJitterBuffer(receiver: RTCRtpReceiver): void {
  try {
    if ("jitterBufferTarget" in receiver) {
      (receiver as RTCRtpReceiver & { jitterBufferTarget: number | null })
        .jitterBufferTarget = 0;
    }
  } catch {
    // Some builds expose the property but reject the assignment.
  }
}
