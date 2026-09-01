"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerHandle } from "./player";
import {
  needsCorrection,
  stateAt,
  targetPosition,
  type PlaybackState,
} from "./sync";
import type { SyncedClock } from "@/lib/sync/SyncedClock";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** How often to check the player against the shared state. */
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
  playing: boolean;
  load: (videoId: string, startSec?: number) => void;
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
    videoId: null,
    positionSec: 0,
    playing: false,
    atSharedTime: 0,
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const clockRef = useRef(clock);
  const sendRef = useRef(send);
  useEffect(() => {
    clockRef.current = clock;
    sendRef.current = send;
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
        positionSec: next.positionSec,
        playing: next.playing,
        atSharedTime: next.atSharedTime,
      });
    },
    [],
  );

  const load = useCallback(
    (videoId: string, startSec = 0) => {
      broadcast(stateAt(videoId, startSec, false, now()));
    },
    [broadcast, now],
  );

  const playPause = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.videoId) return;
    // Stamp from where the player actually is, not from the last stamp, or
    // every pause would rewind to wherever the previous message left off.
    const at = player.current?.isReady()
      ? player.current.currentTime()
      : targetPosition(cur, now());
    broadcast(stateAt(cur.videoId, at, !cur.playing, now()));
  }, [broadcast, now]);

  const resync = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.videoId) return;
    broadcast(stateAt(cur.videoId, targetPosition(cur, now()), cur.playing, now()));
  }, [broadcast, now]);

  const clear = useCallback(() => {
    broadcast(stateAt(null, 0, false, now()));
  }, [broadcast, now]);

  const accept = useCallback((msg: PeerMessage) => {
    if (msg.t !== "media") return;
    const next: PlaybackState = {
      videoId: msg.videoId,
      positionSec: msg.positionSec,
      playing: msg.playing,
      atSharedTime: msg.atSharedTime,
    };
    setState(next);
    stateRef.current = next;
  }, []);

  // Drive the player towards the shared state, and keep restating it.
  useEffect(() => {
    const loadedRef = { current: null as string | null };

    const tick = () => {
      const p = player.current;
      const cur = stateRef.current;
      if (!p?.isReady()) return;

      if (cur.videoId === null) {
        loadedRef.current = null;
        p.pause();
        return;
      }

      const want = targetPosition(cur, now());

      if (loadedRef.current !== cur.videoId) {
        loadedRef.current = cur.videoId;
        p.load(cur.videoId, want);
        return;
      }

      if (needsCorrection(p.currentTime(), want)) p.seek(want);
      if (cur.playing) p.play();
      else p.pause();
    };

    const correcting = setInterval(tick, CORRECT_INTERVAL_MS);
    tick();

    const beating = setInterval(() => {
      const cur = stateRef.current;
      if (cur.videoId === null) return;
      sendRef.current({
        t: "media",
        videoId: cur.videoId,
        positionSec: cur.positionSec,
        playing: cur.playing,
        atSharedTime: cur.atSharedTime,
      });
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(correcting);
      clearInterval(beating);
    };
  }, [now]);

  return {
    videoId: state.videoId,
    playing: state.playing,
    load,
    playPause,
    resync,
    clear,
    accept,
  };
}
