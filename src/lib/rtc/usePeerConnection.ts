"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIceServers } from "./iceServers";
import { decode, encode, type PeerMessage } from "./protocol";
import { SyncedClock } from "@/lib/sync/SyncedClock";
import { selectPath, type PathInfo } from "./path";
import { preferMusicAudio } from "./sdp";
import { readJitter, jitterDelayMs, type JitterSample } from "./videoStats";
import {
  readAudio,
  audioJitterMs,
  audioBitrateKbps,
  readAudioFormat,
  type AudioSample,
  type AudioFormat,
} from "./audioStats";
import {
  readTopology,
  readTraffic,
  trafficRates,
  formatReport,
  type Topology,
  type TrafficSample,
  type TrafficRates,
} from "./diagnostics";
import { leashSenders, type VideoMode } from "./videoLeash";
import { shouldPause } from "./fileChannel";
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
  /**
   * The same measurement for the voice. Kept separate from the video figure
   * because the two buffers behave differently and an average of them
   * describes neither — and because this one, plus half the round trip, is how
   * far behind the other person's singing arrives.
   */
  audioJitterMs: number | null;
  /**
   * What the voice was actually negotiated at, and what it is really costing.
   * 48000Hz stereo is healthy; 16000Hz mono means the device fell back to a
   * narrowband voice profile, which is heard as a thin, filtered voice and is
   * not something any setting in this app can undo.
   */
  audioFormat: AudioFormat | null;
  audioKbps: number | null;
  rtt: number;
  mediaError: string | null;
  clock: SyncedClock | null;
  send: (m: PeerMessage) => void;
  /** Sends one chunk of a file. Returns false when the channel is not open
   *  or the send buffer is too full to accept more right now. */
  sendFileChunk: (chunk: ArrayBuffer) => boolean;
  /** Registers the receiver for inbound file chunks. Returns an unsubscribe
   *  function. Only one receiver at a time; a second call replaces the first. */
  onFileChunk: (handler: (chunk: ArrayBuffer) => void) => () => void;
  /** Everything known about the route, as pasteable text. */
  report: (activity: string | null) => string;
  /** Caps the outgoing camera, or lets it run free. */
  setVideoMode: (mode: VideoMode) => void;
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

/**
 * How long a call may sit in "disconnected" before we go and get it.
 *
 * "disconnected" is limbo, not death: packets stopped arriving, but nothing
 * has formally broken and the browser will often heal it by itself within a
 * second or two. Restarting immediately would tear down calls that were about
 * to recover on their own.
 *
 * But the browser is also allowed to sit there indefinitely, and it does —
 * which is the call that appears frozen and never comes back. Waiting for
 * "failed" is not a plan, because on some networks that transition never
 * arrives. So: long enough for self-healing, short enough that nobody has
 * time to give up and reload the page.
 */
const DISCONNECTED_GRACE_MS = 4000;

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
  const [audioJitter, setAudioJitter] = useState<number | null>(null);
  const [audioFormat, setAudioFormat] = useState<AudioFormat | null>(null);
  const [audioKbps, setAudioKbps] = useState<number | null>(null);
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
  const audioRef = useRef<AudioSample | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const fileDcRef = useRef<RTCDataChannel | null>(null);
  const clockRef = useRef<SyncedClock | null>(null);
  const offeredRef = useRef(false);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  // Declared here, above the connection handlers that arm and cancel it: the
  // React Compiler refuses a ref first written inside a closure below it.
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in refs rather than state: nothing renders from them, and a report is
  // only ever built at the instant someone asks for one.
  const topologyRef = useRef<Topology | null>(null);
  const trafficRef = useRef<TrafficSample | null>(null);
  const ratesRef = useRef<TrafficRates | null>(null);
  const connectedAt = useRef<number | null>(null);
  const onMessageRef = useRef(onMessage);
  const onFileChunkRef = useRef<((chunk: ArrayBuffer) => void) | null>(null);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });
  const sendSignalRef = useRef<(m: SignalMessage) => void>(() => {});

  const send = useCallback((m: PeerMessage) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(encode(m));
  }, []);

  const sendFileChunk = useCallback((chunk: ArrayBuffer) => {
    const dc = fileDcRef.current;
    if (!dc || dc.readyState !== "open" || shouldPause(dc.bufferedAmount)) {
      return false;
    }
    dc.send(chunk);
    return true;
  }, []);

  const onFileChunk = useCallback((handler: (chunk: ArrayBuffer) => void) => {
    onFileChunkRef.current = handler;
    return () => {
      if (onFileChunkRef.current === handler) onFileChunkRef.current = null;
    };
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

  const wireFileChannel = useCallback((dc: RTCDataChannel) => {
    dc.binaryType = "arraybuffer";
    fileDcRef.current = dc;
    dc.onmessage = (e) => {
      // Some browsers ignore binaryType and deliver Blob; callers only accept
      // ArrayBuffer chunks, so never hand them a payload they cannot assemble.
      if (!(e.data instanceof ArrayBuffer)) return;
      onFileChunkRef.current?.(e.data);
    };
    dc.onclose = () => {
      if (fileDcRef.current === dc) fileDcRef.current = null;
    };
  }, []);

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
    pc.ondatachannel = (e) => {
      if (e.channel.label === "sync") {
        wireDataChannel(e.channel);
        return;
      }
      if (e.channel.label === "files") wireFileChannel(e.channel);
    };
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
          // Whatever the blip was, it healed. Stand the rescue down before it
          // restarts a connection that is now working perfectly well.
          cancelRecovery(recoveryTimer);
          // Kept from the FIRST connect, not refreshed on every recovery: the
          // report should say how long the evening has been going, not how
          // long since the last hiccup.
          connectedAt.current ??= Date.now();
          setState("connected");
          break;
        case "disconnected":
          setState("reconnecting");
          // Only the side that made the offer may restart, or both would
          // renegotiate at once and collide.
          if (!offeredRef.current || recoveryTimer.current !== null) break;
          recoveryTimer.current = setTimeout(() => {
            recoveryTimer.current = null;
            // Re-read the live state: four seconds is long enough for the
            // browser to have quietly fixed it, and restarting a healthy
            // connection is the one way this can make things worse.
            if (pc.connectionState !== "disconnected") return;
            void restartIce(pc, sendSignalRef.current);
          }, DISCONNECTED_GRACE_MS);
          break;
        case "failed":
          cancelRecovery(recoveryTimer);
          setState("failed");
          if (offeredRef.current) void restartIce(pc, sendSignalRef.current);
          break;
      }
    };
    return pc;
  }, [localStream, wireDataChannel, wireFileChannel]);

  const signaling = useSignaling(
    code,
    {
    onPeer: async (_peer: PeerInfo, iOffer: boolean, restarted: boolean) => {
      // They came back on a new connection. Ours is pointing at the session
      // they left, and no part of it can be reused -- including the flag that
      // says we already offered, which is what used to leave this side
      // certain it had done its job while the other waited forever.
      if (restarted) dropConnection();
      if (!iOffer || offeredRef.current) return;
      offeredRef.current = true;
      setState("connecting");
      const pc = pcRef.current ?? (await buildConnection());
      wireDataChannel(pc.createDataChannel("sync", { ordered: true }));
      wireFileChannel(pc.createDataChannel("files", { ordered: true }));
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

      // The evidence behind the report, gathered on the poll that is already
      // running. Rates need two samples, so they only appear from the second
      // poll onwards — which is why the button is worth pressing a little way
      // into a call rather than the instant it connects.
      topologyRef.current = readTopology(stats);
      const traffic = readTraffic(stats);
      if (traffic) {
        ratesRef.current = trafficRates(trafficRef.current, traffic);
        trafficRef.current = traffic;
      }

      const sample = readJitter(stats);
      if (sample) {
        setJitterMs(jitterDelayMs(jitterRef.current, sample));
        jitterRef.current = sample;
      }

      const audio = readAudio(stats);
      if (audio) {
        setAudioJitter(audioJitterMs(audioRef.current, audio));
        setAudioKbps(audioBitrateKbps(audioRef.current, audio));
        audioRef.current = audio;
      }
      setAudioFormat(readAudioFormat(stats));
    };

    void sample();
    const id = setInterval(() => void sample(), PATH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state]);

  useEffect(() => {
    const pending = recoveryTimer;
    return () => {
      cancelRecovery(pending);
      clockRef.current?.stop();
      dcRef.current?.close();
      fileDcRef.current?.close();
      fileDcRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      offeredRef.current = false;
    };
  }, [code, attempt]);

  /**
   * Everything known about the route, as text to paste to someone who can act
   * on it.
   *
   * This exists because the interesting failures happen at eleven at night on
   * a laptop in another country. A number read off the status bar and typed
   * into a chat loses the very fields that distinguish "the relay is far away"
   * from "the video is trampling the voice" — so the app writes them down.
   */
  const report = useCallback(
    (activity: string | null) =>
      formatReport({
        topology: topologyRef.current,
        rates: ratesRef.current,
        sample: trafficRef.current,
        netRttMs: path?.netRtt ?? null,
        pingRttMs: rtt > 0 ? rtt : null,
        audioJitterMs: audioJitter,
        videoJitterMs: jitterMs,
        audioCodec: audioFormat?.codec ?? null,
        activity,
        connectedForMs:
          connectedAt.current === null ? null : Date.now() - connectedAt.current,
      }),
    [path, rtt, audioJitter, jitterMs, audioFormat],
  );

  /**
   * Puts the camera on a leash, or takes it off.
   *
   * Called when karaoke opens and closes. Video is greedy and does not care
   * who else is using the link: on a relayed intercontinental path an
   * uncapped 720p stream is enough to push the voice packets into clumps,
   * which the browser then absorbs by holding the voice back even further.
   * Every other activity keeps full quality, because only singing is ruined
   * by the delay this buys back.
   */
  const setVideoMode = useCallback((mode: VideoMode) => {
    const pc = pcRef.current;
    if (!pc) return;
    void leashSenders(pc.getSenders(), mode);
  }, []);

  /**
   * Throws away the current connection without touching the camera or this
   * side's place in the room.
   *
   * Used when the OTHER person comes back: their connection is brand new and
   * everything held here describes the session they walked out of. Kept
   * separate from `retry` on purpose -- retry re-announces us, which would
   * give this side a later arrival time and could have the two of us swapping
   * who offers back and forth forever.
   */
  const dropConnection = useCallback(() => {
    cancelRecovery(recoveryTimer);
    connectedAt.current = null;
    topologyRef.current = null;
    trafficRef.current = null;
    ratesRef.current = null;
    clockRef.current?.stop();
    clockRef.current = null;
    setClock(null);
    dcRef.current?.close();
    dcRef.current = null;
    fileDcRef.current?.close();
    fileDcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    offeredRef.current = false;
    pendingIce.current = [];
    jitterRef.current = null;
    audioRef.current = null;
    setRemoteStream(null);
    setPath(null);
    setJitterMs(null);
    setAudioJitter(null);
    setIceSettled(false);
    setState("connecting");
  }, []);

  const retry = useCallback(() => {
    cancelRecovery(recoveryTimer);
    connectedAt.current = null;
    topologyRef.current = null;
    trafficRef.current = null;
    ratesRef.current = null;
    clockRef.current?.stop();
    dcRef.current?.close();
    fileDcRef.current?.close();
    fileDcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    offeredRef.current = false;
    pendingIce.current = [];
    setRemoteStream(null);
    setPath(null);
    setJitterMs(null);
    jitterRef.current = null;
    audioRef.current = null;
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
    audioJitterMs: audioJitter,
    audioFormat,
    audioKbps,
    rtt,
    mediaError,
    clock,
    send,
    sendFileChunk,
    onFileChunk,
    report,
    setVideoMode,
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

/** Stands down a pending rescue, wherever the connection ended up. */
function cancelRecovery(
  timer: { current: ReturnType<typeof setTimeout> | null },
): void {
  if (timer.current === null) return;
  clearTimeout(timer.current);
  timer.current = null;
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
