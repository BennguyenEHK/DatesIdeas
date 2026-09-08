"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerHandle } from "./player";
import {
  needsCorrection,
  rampPlan,
  glidePlan,
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
 *
 * It could not, however, catch the error a song opens with. The position is
 * stamped when play() is CALLED, and a video element does not begin at that
 * instant -- it decodes and spins up, by a different amount on each machine.
 * Checked immediately afterwards the player still reads its pre-play position,
 * so the error does not exist yet; by the time it does, the next look is up to
 * two seconds away. That is what `correct` is for: it is called the moment
 * playback genuinely starts, when the error is real and measurable.
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

/**
 * The shortest stretch of playback worth drawing a conclusion from.
 *
 * Under this there is simply not enough evidence: a player that has been
 * running for a fifth of a second has not had time to prove anything, and
 * treating it as stuck would suppress the correction that belongs at the very
 * start of a song, where the error is the player's own start-up delay.
 */
const STALL_WINDOW_MS = 1000;

/**
 * How much of the elapsed time a player must actually have played to count as
 * running.
 *
 * A player waiting on the network does not move at all, and one rebuffering
 * every few seconds crawls. Either way, the position it reports is not drift
 * that can be corrected -- it is a connection that cannot deliver the film, and
 * a quarter of real speed is far below anything a working player produces.
 */
const STALL_PROGRESS_RATIO = 0.25;

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
  /**
   * Re-check this player against shared time and fix it, telling the peer
   * nothing.
   *
   * Distinct from `resync`, which BROADCASTS this player's position as the new
   * truth. The one moment this exists for is the moment playback actually
   * begins, where this side is simply late and the other side is not wrong.
   */
  correct: () => void;
  /**
   * Playback has genuinely begun on this side.
   *
   * Distinct from `correct`, and the distinction is the whole point. A player
   * that has just started is not a player that has drifted: it is exactly where
   * it should be, and shared time has simply been running without it while it
   * fetched and decoded. Correcting that is how a start-up delay became a jump.
   */
  started: () => void;
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

  // The last offset value that was applied by the setpoint path. Declared here
  // with the other refs because applyState modifies it and several closures
  // capture it. Initialized to the current offset so spurious corrections are
  // not triggered on the first call before the user has changed the offset.
  const lastAppliedOffset = useRef(offsetSec);

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

  /**
   * Whether the playback about to begin was asked for here.
   *
   * Only the side that pressed play may re-stamp shared time when its film
   * actually starts. If both did, each would publish its own start-up delay as
   * truth and the two would chase each other for the length of the film.
   */
  const iStartedPlay = useRef(false);

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
    // Only when starting. A pause has no start-up delay to absorb, and leaving
    // the flag set would let the next inbound play be re-stamped from here.
    iStartedPlay.current = !cur.playing;
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

  /**
   * The last position this player was seen at while playing, and when.
   *
   * The one thing that distinguishes a player which has drifted from a player
   * which is waiting on the network, and they need opposite treatment. A film
   * that has drifted should be moved. A film that is buffering must be left
   * alone, because seeking is exactly what empties the buffer -- so correcting
   * it puts it further behind, which earns it another correction two seconds
   * later, which puts it further behind again. On a connection too slow to
   * refill there is no exit from that, which is why one person's film lagged
   * for the whole evening while the other's came right after twenty seconds.
   *
   * Set to the position a correction ASKED for rather than the one that was
   * read back, because the playhead reports wherever it was sent whether or not
   * the film ever arrived there -- and reading that back as progress would let
   * the loop start over on the very next look.
   */
  const lastLook = useRef<{ position: number; at: number } | null>(null);


  const applyState = useCallback(() => {
    const p = player.current;
    const cur = stateRef.current;
    if (!p?.isReady()) return;

    if (cur.videoId === null) {
      cancelRamp();
      loadedId.current = null;
      lastLook.current = null;
      p.pause();
      return;
    }

    const want = targetPosition(cur, now(), offsetRef.current);

    const filmKey = `${cur.source}:${cur.videoId}`;
    if (loadedId.current !== filmKey) {
      cancelRamp();
      loadedId.current = filmKey;
      // Nothing observed of the last film says anything about this one.
      lastLook.current = null;
      p.load(cur.videoId, want);
      // A song that changes while the room is playing -- which is exactly what
      // one arriving from the other side looks like -- must not sit silent
      // until the drift timer next comes round, up to two seconds later.
      // Nothing further down this pass applies to a player that has only just
      // been handed a new source.
      if (cur.playing) p.play();
      return;
    }

    // Play/pause BEFORE seeking, not after. YouTube's seekTo starts playback
    // when the video is merely cued rather than paused, so seeking first
    // would blip the audio on a paused resync. Seeking an already-paused
    // player leaves it paused, which is what makes this order safe.
    if (cur.playing) p.play();
    else {
      cancelRamp();
      // A paused player is not advancing for a perfectly good reason, and
      // holding that against it would block the corrections a paused resync
      // depends on. Cleared rather than kept, so the next run of playback is
      // judged on its own evidence instead of on a reading from before it.
      lastLook.current = null;
      p.pause();
    }

    // A setpoint change (offset) is known exactly and must always be applied,
    // unlike drift which is noisy and unknown. If the offset has changed,
    // correct using glidePlan, which bypasses the deadband entirely.
    const currentOffset = offsetRef.current;
    if (lastAppliedOffset.current !== currentOffset) {
      lastAppliedOffset.current = currentOffset;
      // A ramp already in flight has to be retired before another begins.
      // startRamp overwrites the timer handle without clearing the old timeout,
      // so a second correction started on top of a first would leave the
      // earlier timer pending -- and it fires first, setting the rate back to 1
      // partway through the new correction and stranding the player short of
      // where it was heading.
      cancelRamp();
      const error = p.currentTime() - want;
      const plan = glidePlan(error);
      if (plan && cur.playing && p.setRate(plan.rate)) {
        startRamp(plan.forSec);
      } else if (Math.abs(error) <= NUDGE_LIMIT_SEC) {
        p.nudge(want);
      } else {
        p.seek(want);
      }
      return;
    }

    // How far apart the two copies may sit before it is worth interrupting
    // anyone. A film's answer is four times a song's, and using the song's
    // figure for both is what made movie nights stutter.
    const tolerance = toleranceFor(precisionRef.current);

    // The ramp creates intentional drift. Correcting it again on the safety
    // timer would turn the smooth repair back into the seek it replaces.
    if (ramping.current) return;

    const at = p.currentTime();
    const seenAt = Date.now();
    const previous = lastLook.current;
    lastLook.current = { position: at, at: seenAt };

    if (!needsCorrection(at, want, tolerance)) return;

    // Whether this player is drifting or simply waiting on the network. Asked
    // only of a player that is supposed to be running, and only over a stretch
    // long enough to answer: below that there is no evidence either way, and
    // the benefit of the doubt belongs to correcting.
    //
    // A film that is not keeping up cannot be corrected into keeping up. Every
    // seek sent to it costs it the buffer it was filling, so the correction is
    // what creates the gap it is correcting.
    if (cur.playing && previous !== null) {
      const windowMs = seenAt - previous.at;
      const played = at - previous.position;
      if (windowMs >= STALL_WINDOW_MS && played < (windowMs / 1000) * STALL_PROGRESS_RATIO) {
        return;
      }
    }

    const error = at - want;
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
      lastLook.current = { position: want, at: seenAt };
    } else {
      p.seek(want);
      lastLook.current = { position: want, at: seenAt };
    }
  }, [cancelRamp, now, startRamp]);

  /**
   * Called the instant playback genuinely begins on this side.
   *
   * For the side that asked for it, this re-stamps shared time from where the
   * film actually is rather than dragging the film to where the clock says it
   * should be. That is the correction the old design could not express: a
   * player two seconds into its own start-up has not drifted two seconds, and
   * every attempt to "fix" it moved a film that was already right.
   *
   * The stamp is published rather than applied locally, because the other side
   * is waiting on exactly this number -- it is what lets them start from the
   * moment the film really began instead of the moment a button was pressed.
   *
   * For the following side there is nothing to publish, so this falls back to
   * an ordinary correction: they genuinely do have to catch up to a stamp
   * somebody else set.
   */
  const started = useCallback(() => {
    const p = player.current;
    const cur = stateRef.current;
    if (!p?.isReady() || cur.videoId === null || !cur.playing) return;

    if (!iStartedPlay.current) {
      applyState();
      return;
    }
    iStartedPlay.current = false;
    cancelRamp();
    // The local offset is a private accommodation for voice latency, so it has
    // to come back off before this becomes shared truth.
    broadcast(stateAt(cur, p.currentTime() + offsetRef.current, true, now()));
  }, [applyState, broadcast, cancelRamp, now]);


  const accept = useCallback((msg: PeerMessage) => {
    if (msg.t !== "media") return;
    const cur = stateRef.current;
    if (cur.videoId !== msg.videoId || cur.source !== msg.source) cancelRamp();
    // Their film now, so their length is the one to measure against.
    iChose.current = false;
    // Their message, so the playback beginning here is a response to theirs.
    // Re-stamping from this side would publish our start-up delay over theirs.
    iStartedPlay.current = false;
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
    correct: applyState,
    started,
    clear,
    accept,
  };
}
