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
  type MicReport,
} from "./diagnostics";
import {
  applyAudioPriority,
  budgetFor,
  leashSenders,
  sameSettings,
  type LeashSettings,
  type RouteQuality,
  type VideoMode,
} from "./videoLeash";
import {
  applyJitterTarget,
  jitterTargetMs,
  type ReceiverLike,
} from "./jitterBuffer";
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
  /**
   * Why the TURN credentials are not what they should be, or null when they are.
   *
   * A call that falls back to public STUN alone still connects on a friendly
   * network, so nothing about the picture says anything is wrong -- right up
   * until the evening one of you is behind a NAT that needs a relay, and the
   * call simply never joins with no explanation anywhere.
   */
  turnDegraded: string | null;
  mediaError: string | null;
  clock: SyncedClock | null;
  send: (m: PeerMessage) => void;
  /** Sends one chunk of a file. Returns false when the channel is not open
   *  or the send buffer is too full to accept more right now. */
  sendFileChunk: (chunk: ArrayBuffer) => boolean;
  /**
   * Whether there is a file channel to send on at all.
   *
   * Separate from sendFileChunk because its `false` answers two questions at
   * once: a full buffer, which drains if you wait, and a closed channel, which
   * never does. A sender that cannot tell them apart waits on the second one
   * forever.
   */
  fileChannelOpen: () => boolean;
  /** Registers the receiver for inbound file chunks. Returns an unsubscribe
   *  function. Only one receiver at a time; a second call replaces the first. */
  onFileChunk: (handler: (chunk: ArrayBuffer) => void) => () => void;
  /**
   * Everything known about the route AND the microphone, as pasteable text.
   *
   * The microphone is passed in rather than read here because this hook owns
   * the connection, not the singing: the level measurement is taken by whoever
   * is already watching the raw input.
   */
  report: (activity: string | null, mic: MicReport | null) => string;
  /** Caps the outgoing camera, or lets it run free. */
  setVideoMode: (mode: VideoMode) => void;
  /** Whether this side's microphone is currently sending anything. */
  micOn: boolean;
  /** Whether this side's camera is currently sending a picture. */
  camOn: boolean;
  /**
   * Switches this side's microphone or camera, for real.
   *
   * Disables the track rather than stopping it. A stopped track is gone: the
   * camera light goes out, but turning it back on means asking the browser for
   * the device again and renegotiating, and on some machines the second request
   * is refused. A disabled track stays in the call and transmits silence and
   * black frames, which costs almost nothing and comes back instantly.
   *
   * The other side is told separately, because silence and black frames look
   * exactly like a broken connection.
   */
  setMicOn: (on: boolean) => void;
  setCamOn: (on: boolean) => void;
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

/** How coarsely a measured round trip is bucketed before it can change a decision. */
const RTT_BUCKET_MS = 50;

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
  // Why TURN is not what it should be, or null when it answered normally.
  const [turnDegraded, setTurnDegraded] = useState<string | null>(null);
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
  // The switches themselves. Held here rather than in the page because the
  // stream they act on is acquired here, and because a stream that arrives
  // after the switch was thrown still has to come up in the state it was left.
  const [micOn, setMicOnState] = useState(true);
  const [camOn, setCamOnState] = useState(true);
  // Declared above the two switches below, which write through it: the React
  // Compiler refuses a ref first modified inside a closure declared above it.
  // A ref rather than the state value because a switch thrown while a stream is
  // being re-acquired must still find the stream that eventually arrives.
  const streamRef = useRef<MediaStream | null>(null);

  // The route as the senders and receivers need to hear about it. Held as
  // state rather than a ref because both the camera budget and the jitter
  // buffers have to be re-applied when it changes, and ICE migrates mid-call.
  const [route, setRoute] = useState<RouteQuality | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Every receiver this connection has produced, so a route change can retune
  // buffers that were set once at ontrack and never revisited.
  const receiversRef = useRef<RTCRtpReceiver[]>([]);
  // The same value as the state above, reachable from the connection handlers.
  // Declared here rather than beside them because the React Compiler refuses a
  // ref first written inside a closure declared above it.
  const routeRef = useRef<RouteQuality | null>(null);
  // What the current activity asked for. Karaoke is the one activity where two
  // people try to sing in time with each other, so it doubles as the answer to
  // "is anyone duetting" that the buffer policy needs.
  const modeRef = useRef<VideoMode>("full");
  // What the encoder and the buffers were last actually told. The route is
  // recomputed from a wobbling measurement every three seconds; these are what
  // stop that wobble from being handed to a running encoder as if it were news.
  const appliedLeash = useRef<LeashSettings | null>(null);
  const appliedTargets = useRef<string | null>(null);
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

  const fileChannelOpen = useCallback(() => {
    const dc = fileDcRef.current;
    return dc !== null && dc !== undefined && dc.readyState === "open";
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
    const ice = await fetchIceServers();
    // Kept rather than discarded. /api/turn answers with public STUN and a
    // reason string whenever Cloudflare could not be asked, and the route that
    // produces it says in as many words that the UI must surface the degraded
    // state rather than hide it. Destructuring only `iceServers` here is what
    // made a silent fall back to STUN-only indistinguishable from a healthy
    // call that simply never found a direct path.
    setTurnDegraded(ice.degraded ?? null);
    const pc = new RTCPeerConnection({
      iceServers: ice.iceServers,
      iceCandidatePoolSize: 4,
    });
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
      // Kept, because the buffer this receiver wants depends on a route that is
      // usually not known yet at this instant and can change later anyway. The
      // effect below retunes everything collected here whenever it does.
      receiversRef.current.push(e.receiver);
      tuneReceiver(e.receiver, routeRef.current, modeRef.current === "lean");
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
      const pathNow = selectPath(stats);
      setPath(pathNow);

      // The evidence behind the report, gathered on the poll that is already
      // running. Rates need two samples, so they only appear from the second
      // poll onwards — which is why the button is worth pressing a little way
      // into a call rather than the instant it connects.
      // Kept only when the snapshot actually described a route. ICE spends
      // stretches of a restart with no succeeded pair at all, and readTopology
      // answers null for those instants -- which is honest about the snapshot
      // and wrong about the call. Overwriting with it is what printed
      // "Route: unknown" on a connection that had been up for fourteen minutes.
      // The last known good answer is the better thing to hold.
      const topology = readTopology(stats);
      if (topology !== null) topologyRef.current = topology;

      // Derived from the sticky value, not the raw snapshot, so a poll that
      // landed mid-restart cannot briefly tell the encoder the call went direct.
      // Replaced only when something actually moved: a fresh object every three
      // seconds would re-apply the camera budget and retune every jitter buffer
      // on a call where nothing had changed.
      const nextRoute = routeFrom(topologyRef.current, pathNow?.netRtt ?? null);
      setRoute((current) => (sameRoute(current, nextRoute) ? current : nextRoute));

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
    (activity: string | null, mic: MicReport | null) =>
      formatReport({
        mic,
        topology: topologyRef.current,
        degraded: turnDegraded,
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
        syncChannel: dcRef.current?.readyState ?? null,
        fileChannel: fileDcRef.current?.readyState ?? null,
      }),
    [path, rtt, audioJitter, jitterMs, audioFormat, turnDegraded],
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
  // Re-applies both switches to whatever stream is current. A retry throws the
  // camera away and asks for a new one, and a fresh track always arrives
  // enabled -- so without this, reconnecting silently turns a muted microphone
  // back on, which is the one failure here nobody would forgive.
  useEffect(() => {
    streamRef.current = localStream;
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = micOn;
    for (const track of localStream?.getVideoTracks() ?? []) track.enabled = camOn;
  }, [localStream, micOn, camOn]);

  const setMicOn = useCallback((on: boolean) => {
    setMicOnState(on);
    for (const track of streamRef.current?.getAudioTracks() ?? []) track.enabled = on;
  }, []);

  const setCamOn = useCallback((on: boolean) => {
    setCamOnState(on);
    for (const track of streamRef.current?.getVideoTracks() ?? []) track.enabled = on;
  }, []);

  const setVideoMode = useCallback((mode: VideoMode) => {
    modeRef.current = mode;
    const pc = pcRef.current;
    if (!pc) return;
    // Karaoke is the one activity where two people try to sing in time with
    // each other, and that wants the shortest buffer it can survive rather than
    // the steadiest one. Opening or closing it changes the answer, so the
    // buffers are retuned here and not only when the route moves.
    applyRouteDecisions(
      pc,
      routeRef.current,
      mode,
      receiversRef.current,
      appliedLeash,
      appliedTargets,
    );
  }, []);

  /**
   * Re-applies everything that depends on the route, whenever the route moves.
   *
   * ICE migrates mid-call, and until now the camera budget was set once when
   * karaoke opened and never revisited -- so a call that started direct and
   * later fell back to a relay went on sending relay-sized video down a
   * relay-sized pipe for the rest of the evening.
   */
  useEffect(() => {
    routeRef.current = route;
    const pc = pcRef.current;
    if (pc === null || route === null) return;
    applyRouteDecisions(
      pc,
      route,
      modeRef.current,
      receiversRef.current,
      appliedLeash,
      appliedTargets,
    );
  }, [route]);

  /**
   * Gives the voice first claim on the link, once there is a link to claim.
   *
   * Deliberately after connection rather than at addTrack: parameters set on a
   * transceiver the browser has not finished negotiating are rejected, and a
   * rejection here is silent.
   */
  useEffect(() => {
    if (state !== "connected") return;
    const pc = pcRef.current;
    if (!pc) return;
    for (const sender of pc.getSenders()) void applyAudioPriority(sender);
  }, [state]);

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
    receiversRef.current = [];
    appliedLeash.current = null;
    appliedTargets.current = null;
    setRoute(null);
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
    receiversRef.current = [];
    appliedLeash.current = null;
    appliedTargets.current = null;
    setRoute(null);
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
    turnDegraded,
    mediaError,
    clock,
    send,
    sendFileChunk,
    fileChannelOpen,
    onFileChunk,
    report,
    setVideoMode,
    micOn,
    camOn,
    setMicOn,
    setCamOn,
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
 * Applies the route's consequences to the senders and receivers -- but only the
 * ones that actually changed.
 *
 * This guard is the whole point of the function. The route is recomputed from a
 * live RTT measurement on every stats poll, three seconds apart, and that
 * measurement wobbles by tens of milliseconds. Two consecutive readings almost
 * always describe the same relayed, slow, TCP-carried path: the same decision,
 * reached again.
 *
 * Handing that to the encoder anyway is expensive in a way that is invisible
 * from here. setParameters on a running sender reconfigures it and costs a
 * keyframe, so a wobbling measurement became a keyframe every three seconds,
 * forever, on a link already too small for the call -- and anything else
 * sharing that link, such as a film being buffered from YouTube, is what pays
 * for it. Comparing the RESULT rather than the measurement is what stops that.
 */
function applyRouteDecisions(
  pc: RTCPeerConnection,
  route: RouteQuality | null,
  mode: VideoMode,
  receivers: readonly RTCRtpReceiver[],
  appliedLeash: { current: LeashSettings | null },
  appliedTargets: { current: string | null },
): void {
  const budget = budgetFor(mode, route);
  if (appliedLeash.current === null || !sameSettings(appliedLeash.current, budget)) {
    appliedLeash.current = budget;
    void leashSenders(pc.getSenders(), mode, route);
  }

  // The buffers get the same treatment, keyed on the two targets they resolve
  // to rather than on the route that produced them.
  const duetting = mode === "lean";
  const targets = `${jitterTargetMs("audio", route, duetting)}/${jitterTargetMs("video", route, duetting)}`;
  if (appliedTargets.current !== targets) {
    appliedTargets.current = targets;
    for (const receiver of receivers) tuneReceiver(receiver, route, duetting);
  }
}

/**
 * Reduces a route to the handful of facts the sender budget and the buffer
 * policy actually decide on.
 */
function routeFrom(
  topology: Topology | null,
  netRttMs: number | null,
): RouteQuality | null {
  if (topology === null) return null;
  return {
    relayed: topology.relayed,
    relayProtocol: topology.relayProtocol,
    // Rounded to a coarse step on purpose. The live measurement wobbles by a
    // few milliseconds from one poll to the next, and treating every distinct
    // value as a new route would re-apply the camera budget and retune every
    // buffer twenty times a minute in response to noise. Everything downstream
    // compares against thresholds, so only the bucket was ever load-bearing.
    netRttMs:
      netRttMs === null
        ? null
        : Math.round(netRttMs / RTT_BUCKET_MS) * RTT_BUCKET_MS,
  };
}

/** Whether two routes would produce the same decisions, so one can be ignored. */
function sameRoute(a: RouteQuality | null, b: RouteQuality | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.relayed === b.relayed &&
    a.relayProtocol === b.relayProtocol &&
    a.netRttMs === b.netRttMs
  );
}

/**
 * Gives one receiver the buffer its route can actually sustain.
 *
 * This used to ask every receiver for a zero-length buffer, on the reasoning
 * that the browser would grow it again when the network turned rough. It does —
 * and that growing IS the problem on a long relayed link. Asking for nothing
 * on a path that needs something is what made the buffer underrun, balloon past
 * a second, drain and underrun again, which reads as a voice that keeps falling
 * behind and catching up rather than as one steady delay you stop noticing.
 */
function tuneReceiver(
  receiver: RTCRtpReceiver,
  route: RouteQuality | null,
  duetting: boolean,
): void {
  const kind = receiver.track?.kind === "video" ? "video" : "audio";
  applyJitterTarget(
    receiver as unknown as ReceiverLike,
    jitterTargetMs(kind, route, duetting),
  );
}
