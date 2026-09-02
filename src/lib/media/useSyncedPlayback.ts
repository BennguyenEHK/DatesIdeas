"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerHandle } from "./player";
import {
  needsCorrection,
  stateAt,
  targetPosition,
  NO_FILM,
  type Film,
  type PlaybackState,
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

  const clockRef = useRef(clock);
  const sendRef = useRef(send);
  const offsetRef = useRef(offsetSec);
  useEffect(() => {
    clockRef.current = clock;
    sendRef.current = send;
    offsetRef.current = offsetSec;
  });

  const now = useCallback(
    () => clockRef.current?.now() ?? Date.now(),
    [],
  );

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
      iChose.current = true;
      broadcast(stateAt(film, startSec, false, now()));
    },
    [broadcast, now],
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
    // Stamp from where the player actually is, not from the last stamp, or
    // every pause would rewind to wherever the previous message left off.
    const at = player.current?.isReady()
      // The player is deliberately behind shared time for voice latency, so
      // put that local accommodation back before broadcasting shared truth.
      ? player.current.currentTime() + offsetRef.current
      : targetPosition(cur, now());
    broadcast(stateAt(cur, at, !cur.playing, now()));
  }, [broadcast, now]);

  const resync = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.videoId) return;
    broadcast(stateAt(cur, targetPosition(cur, now()), cur.playing, now()));
  }, [broadcast, now]);

  const clear = useCallback(() => {
    broadcast(stateAt(NO_FILM, 0, false, now()));
  }, [broadcast, now]);

  /** Which video the player is actually showing, as opposed to asked to show. */
  const loadedId = useRef<string | null>(null);


  const applyState = useCallback(() => {
    const p = player.current;
    const cur = stateRef.current;
    if (!p?.isReady()) return;

    if (cur.videoId === null) {
      loadedId.current = null;
      p.pause();
      return;
    }

    const want = targetPosition(cur, now(), offsetRef.current);

    if (loadedId.current !== cur.videoId) {
      loadedId.current = cur.videoId;
      p.load(cur.videoId, want);
      return;
    }

    // Play/pause BEFORE seeking, not after. YouTube's seekTo starts playback
    // when the video is merely cued rather than paused, so seeking first
    // would blip the audio on a paused resync. Seeking an already-paused
    // player leaves it paused, which is what makes this order safe.
    if (cur.playing) p.play();
    else p.pause();
    if (needsCorrection(p.currentTime(), want)) p.seek(want);
  }, [now]);

  const accept = useCallback((msg: PeerMessage) => {
    if (msg.t !== "media") return;
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
  }, []);

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
