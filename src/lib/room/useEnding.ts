"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";
import {
  DARK_HOLD_MS,
  NOTICE_MS,
  TV_OFF_MS,
  countdownLeft,
  reduceEnding,
  type EndingPhase,
} from "./ending";

/**
 * How often the countdown is redrawn.
 *
 * Half a second rather than a whole one, because a clock ticked at exactly its
 * own resolution visibly skips: the tick and the second boundary drift apart
 * until one second is simply never shown.
 */
const TICK_MS = 500;

export interface Ending {
  phase: EndingPhase;
  /** Milliseconds left, or null when nothing is counting. */
  endsInMs: number | null;
  /** Call the evening, here and on the other side. */
  end: () => void;
  /** Call it off, here and on the other side. */
  stay: () => void;
  /** Feed inbound peer messages here; unrelated ones are ignored. */
  accept: (msg: PeerMessage) => void;
}

/**
 * The end of an evening, run to the same moment on both screens.
 *
 * `now` is the SHARED clock rather than this machine's. Two computers disagree
 * about the time by however far their clocks have drifted, and a countdown
 * measured locally would run out at two different moments -- which for the last
 * five minutes of an evening is precisely the thing it must not do.
 */
export function useEnding({
  now,
  send,
  onFinished,
}: {
  now: () => number;
  send: (m: PeerMessage) => void;
  /** Called once, after the black has been held. Navigates away. */
  onFinished: () => void;
}): Ending {
  const [phase, setPhase] = useState<EndingPhase>("none");
  const [endsAt, setEndsAt] = useState<number | null>(null);
  // Nothing reads this. It exists so the interval below can ask for a repaint
  // without the time itself becoming state -- time is not something React owns,
  // and storing it would mean writing state from inside an effect body on every
  // tick, which is a cascading render for a number that can simply be read.
  const [, setTick] = useState(0);

  // Every ref above the closures that read them: the React Compiler refuses a
  // ref first modified inside a closure declared above it.
  const nowRef = useRef(now);
  const sendRef = useRef(send);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    nowRef.current = now;
    sendRef.current = send;
    finishedRef.current = onFinished;
  });

  /** Adopts a moment without telling anyone: for messages that arrived. */
  const adopt = useCallback((at: number | null) => {
    setPhase((current) => {
      const next = reduceEnding(current, { kind: "set", endsAt: at });
      // The phase is what decides whether the moment is still ours to change.
      // Once the picture is going, a cancel is too late to act on and the
      // stored moment must not be cleared out from under it either.
      if (next === current && current !== "counting") return current;
      setEndsAt(next === "none" ? null : at);
      return next;
    });
  }, []);

  const end = useCallback(() => {
    const at = nowRef.current() + NOTICE_MS;
    adopt(at);
    sendRef.current({ t: "ending", endsAt: at });
  }, [adopt]);

  const stay = useCallback(() => {
    adopt(null);
    sendRef.current({ t: "ending", endsAt: null });
  }, [adopt]);

  const accept = useCallback(
    (msg: PeerMessage) => {
      // Adopted rather than answered. An echo would be answered with an echo,
      // and two peers agreeing loudly is how a message loop starts.
      if (msg.t === "ending") adopt(msg.endsAt);
    },
    [adopt],
  );

  // Repaints the countdown, and notices the moment it runs out. Both writes
  // happen inside the interval's callback rather than in the effect body: an
  // effect that sets state as it runs re-renders immediately, every time.
  useEffect(() => {
    if (phase !== "counting" || endsAt === null) return;
    const tick = () => {
      setTick((n) => n + 1);
      if (countdownLeft(endsAt, nowRef.current()) <= 0) {
        setPhase((cur) => reduceEnding(cur, { kind: "reached" }));
      }
    };
    const ticking = setInterval(tick, TICK_MS);
    return () => clearInterval(ticking);
  }, [phase, endsAt]);

  // The picture collapsing, then the black. Both are timers rather than
  // animation callbacks so that the sequence still reaches its end for somebody
  // who has asked for no motion, and still reaches it if an animation is
  // interrupted by a tab going to the background.
  useEffect(() => {
    if (phase !== "closing") return;
    const id = setTimeout(
      () => setPhase((cur) => reduceEnding(cur, { kind: "collapsed" })),
      TV_OFF_MS,
    );
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "dark") return;
    const id = setTimeout(() => finishedRef.current(), DARK_HOLD_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // Read rather than stored. The clock is not React's to own, and asking it
  // here means the number is right on every render rather than as of whenever
  // the last tick happened to land.
  const endsInMs =
    phase === "counting" && endsAt !== null ? countdownLeft(endsAt, now()) : null;

  return { phase, endsInMs, end, stay, accept };
}
