"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerHandle } from "./player";
import {
  needsCorrection,
  rampPlan,
  toleranceFor,
  NUDGE_LIMIT_SEC,
  stateAt,
  targetPosition,
  NO_FILM,
  type Film,
  type PlaybackState,
  type SyncPrecision,
} from "./sync";
import type { SyncedClock } from "@/lib/sync/SyncedClock";
import type { PeerMessage } from "@/lib/rtc/protocol";

/**
 * How often to re-check the player for drift.
 *
 * Only a safety net. State CHANGES are applied the moment they arrive: waiting
 * for this timer put up to two seconds between one person pressing play and
 * the other hearing it, which on a song is not a delay but a different verse.
 */
const CORRECT_INTERVAL_MS = 2000;
/**
 * How often to rebroadcast the state even when nothing changed.
 *
 * The heartbeat is what makes a whole-state protocol self-healing: a peer that
 * joined late, missed a message, or sat through an ad is pulled back in step
 * without anyone noticing there was a problem.
 */
const HEARTBEAT_MS = 5000;

export interface SyncedPlayback {
  videoId: string | null;
  /** What is playing, so a panel can tell a local film from a YouTube one and
   *  compare two copies' lengths. */
  film: Film;
  playing: boolean;
  load: (film: Film, startSec?: number) => void;
  /** Tell the peer how long this local film is, once the browser knows. */
  reportDuration: (seconds: number) => void;
  playPause: () => void;
  resync: () => void;
  clear: () => void;
  /** Feed inbound media messages here. */
  accept: (msg: PeerMessage) => void;
}

/**
 * Keeps two YouTube players on the same moment of the same song.
 *
 * Nothing about the audio crosses the peer connection: each side streams the
 * video itself and only the position travels. That is why the song costs the
 * call no latency at all — and why the players have to be actively held
 * together, since two independent streams drift.
 */
export function useSyncedPlayback(
  handle: PlayerHandle | null,
  clock: SyncedClock | null,
  send: (m: PeerMessage) => void,
  offsetSec = 0,
  /** How tightly to hold the two copies together. A film wants far less than
   *  a song, and correcting it to a song's standard is what stutters it. */
  precision: SyncPrecision = "singing",
): SyncedPlayback {
  // The handle arrives as a plain value and is kept here for the timers. No
  // ref crosses this hook's boundary in either direction: handing one out
  // makes every read of the result count as a ref read, which React forbids
  // during render.
  const player = useRef<PlayerHandle | null>(null);
  useEffect(() => {
    player.current = handle;
  });
  const [state, setState] = useState<PlaybackState>({
    ...NO_FILM,
    positionSec: 0,
    playing: false,
    atSharedTime: 0,
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  /**
   * Whether this side is the one that chose the film.
   *
   * Declared up here with the other refs because both `load` and `accept`
   * write to it, and the React Compiler refuses a ref modified below the hook
   * that closes over it.
   *
   * Only the chooser reports a length. Two people open their own copies of the
   * same film and measure it slightly differently — encoders disagree about
   * trailing silence — so if both reported, each would keep correcting the
   * other's figure, one message per side, forever. The length in shared state
   * belongs to whoever picked the film; everyone else compares against it.
   */
  const iChose = useRef(false);

  // Declared before every callback that changes a ramp because the React
  // Compiler rejects refs that are first modified below a closure over them.
  const rampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ramping = useRef(false);

  const clockRef = useRef(clock);
  const sendRef = useRef(send);
  const offsetRef = useRef(offsetSec);
  const precisionRef = useRef(precision);
  useEffect(() => {
    clockRef.current = clock;
    sendRef.current = send;
    offsetRef.current = offsetSec;
    precisionRef.current = precision;
  });

  const now = useCallback(
    () => clockRef.current?.now() ?? Date.now(),
    [],
  );

  const cancelRamp = useCallback(() => {
    if (rampTimer.current !== null) {
      clearTimeout(rampTimer.current);
      rampTimer.current = null;
    }
    if (!ramping.current) return;
    ramping.current = false;
    // Leaving a local player slightly slow after a cancelled correction makes
    // every later song wrong, which is worse than a one-time sync jump.
    player.current?.setRate(1);
  }, []);

  const startRamp = useCallback((forSec: number) => {
    ramping.current = true;
    rampTimer.current = setTimeout(() => {
      rampTimer.current = null;
      ramping.current = false;
      player.current?.setRate(1);
    }, forSec * 1000);
  }, []);

  /** Adopt a state locally and tell the peer, so both sides agree at once. */
  const broadcast = useCallback(
    (next: PlaybackState) => {
      setState(next);
      stateRef.current = next;
      sendRef.current({
        t: "media",
        videoId: next.videoId,
        source: next.source,
        durationSec: next.durationSec,
        positionSec: next.positionSec,
        playing: next.playing,
        atSharedTime: next.atSharedTime,
      });
    },
    [],
  );

  const load = useCallback(
    (film: Film, startSec = 0) => {
      cancelRamp();
      iChose.current = true;
      broadcast(stateAt(film, startSec, false, now()));
    },
    [broadcast, cancelRamp, now],
  );

  const reportDuration = useCallback(
    (seconds: number) => {
      const cur = stateRef.current;
      if (!iChose.current) return;
      if (cur.videoId === null || cur.durationSec !== null) return;
      // Same moment, same position — only more is known about it now.
      broadcast({ ...cur, durationSec: seconds });
    },
    [broadcast],
  );

  const playPause = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.videoId) return;
    const wasRamping = ramping.current;
    cancelRamp();
    // Stamp from where the player actually is, not from the last stamp, or
    // every pause would rewind to wherever the previous message left off.
    const at = wasRamping
      // A rate correction intentionally makes the physical player disagree
      // with shared time; broadcasting that temporary disagreement would make
      // the other side adopt it as truth.
      ? targetPosition(cur, now())
      : player.current?.isReady()
      // The player is deliberately behind shared time for voice latency, so
      // put that local accommodation back before broadcasting shared truth.
      ? player.current.currentTime() + offsetRef.current
      : targetPosition(cur, now());
    broadcast(stateAt(cur, at, !cur.playing, now()));
  }, [broadcast, cancelRamp, now]);

  const resync = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.videoId) return;
    cancelRamp();
    broadcast(stateAt(cur, targetPosition(cur, now()), cur.playing, now()));
  }, [broadcast, cancelRamp, now]);

  const clear = useCallback(() => {
    cancelRamp();
    broadcast(stateAt(NO_FILM, 0, false, now()));
  }, [broadcast, cancelRamp, now]);

  /** Which video the player is actually showing, as opposed to asked to show. */
  const loadedId = useRef<string | null>(null);


  const applyState = useCallback(() => {
    const p = player.current;
    const cur = stateRef.current;
    if (!p?.isReady()) return;

    if (cur.videoId === null) {
      cancelRamp();
      loadedId.current = null;
      p.pause();
      return;
    }

    const want = targetPosition(cur, now(), offsetRef.current);

    const filmKey = `${cur.source}:${cur.videoId}`;
    if (loadedId.current !== filmKey) {
      cancelRamp();
      loadedId.current = filmKey;
      p.load(cur.videoId, want);
      return;
    }

    // Play/pause BEFORE seeking, not after. YouTube's seekTo starts playback
    // when the video is merely cued rather than paused, so seeking first
    // would blip the audio on a paused resync. Seeking an already-paused
    // player leaves it paused, which is what makes this order safe.
    if (cur.playing) p.play();
    else {
      cancelRamp();
      p.pause();
    }
    // How far apart the two copies may sit before it is worth interrupting
    // anyone. A film's answer is four times a song's, and using the song's
    // figure for both is what made movie nights stutter.
    const tolerance = toleranceFor(precisionRef.current);

    // The ramp creates intentional drift. Correcting it again on the safety
    // timer would turn the smooth repair back into the seek it replaces.
    if (ramping.current || !needsCorrection(p.currentTime(), want, tolerance)) return;

    const error = p.currentTime() - want;
    const plan = rampPlan(error, tolerance);
    if (plan && cur.playing && p.setRate(plan.rate)) {
      startRamp(plan.forSec);
    } else if (Math.abs(error) <= NUDGE_LIMIT_SEC) {
      // Everything a turn change asks for lands here on YouTube, which cannot
      // ramp. Gating this on `plan` instead would have sent exactly the
      // corrections this feature exists to smooth -- a couple of hundred
      // milliseconds, too big to ramp inside the limit -- back to the seek
      // that was stalling the picture in the first place.
      p.nudge(want);
    } else {
      p.seek(want);
    }
  }, [cancelRamp, now, startRamp]);

  const accept = useCallback((msg: PeerMessage) => {
    if (msg.t !== "media") return;
    const cur = stateRef.current;
    if (cur.videoId !== msg.videoId || cur.source !== msg.source) cancelRamp();
    // Their film now, so their length is the one to measure against.
    iChose.current = false;
    const next: PlaybackState = {
      videoId: msg.videoId,
      source: msg.source,
      durationSec: msg.durationSec,
      positionSec: msg.positionSec,
      playing: msg.playing,
      atSharedTime: msg.atSharedTime,
    };
    setState(next);
    stateRef.current = next;
  }, [cancelRamp]);

  // Apply the moment the state changes, from either side. The interval below
  // only exists to catch drift; a change waiting on a timer is a song where
  // one person is two seconds into a verse the other has not started.
  useEffect(() => {
    applyState();
  }, [state, offsetSec, applyState]);

  useEffect(() => {
    const correcting = setInterval(applyState, CORRECT_INTERVAL_MS);

    const beating = setInterval(() => {
      const cur = stateRef.current;
      if (cur.videoId === null) return;
      sendRef.current({
        t: "media",
        videoId: cur.videoId,
        source: cur.source,
        durationSec: cur.durationSec,
        positionSec: cur.positionSec,
        playing: cur.playing,
        atSharedTime: cur.atSharedTime,
      });
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(correcting);
      clearInterval(beating);
    };
  }, [applyState]);

  useEffect(() => cancelRamp, [cancelRamp]);

  return {
    videoId: state.videoId,
    film: {
      videoId: state.videoId,
      source: state.source,
      durationSec: state.durationSec,
    },
    playing: state.playing,
    load,
    reportDuration,
    playPause,
    resync,
    clear,
    accept,
  };
}
