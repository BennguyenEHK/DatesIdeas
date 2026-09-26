"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  judgeRoom,
  ROOM_WINDOW_SAMPLES,
  type RoomReading,
} from "./roomNoise";

/**
 * Latches a noisy-room answer for one karaoke session, for the diagnostics
 * report. Listening only happens while the song is stopped, so the backing
 * track is never mistaken for the room.
 */
export function useRoomNoise(args: {
  /** Karaoke is open and the room switch is on automatic. */
  active: boolean;
  /** Safe to listen: the song is not playing and the microphone is switched on. */
  listening: boolean;
}): {
  /** The automatic answer for this karaoke session. Starts false every session. */
  noisy: boolean;
  /** Feed one RMS reading. Cheap; call it every sample. Stable identity. */
  observe: (rms: number) => void;
  /** The last judged window, for the diagnostics report, or null. */
  reading: RoomReading | null;
} {
  const [noisy, setNoisy] = useState(false);
  const [reading, setReading] = useState<RoomReading | null>(null);

  // These all sit above the callback that writes them. The React Compiler
  // rejects ref mutations captured by a closure declared before its ref.
  const activeRef = useRef(args.active);
  const listeningRef = useRef(args.listening);
  const noisyRef = useRef(false);
  const samplesRef = useRef<number[]>([]);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    activeRef.current = args.active;
    const request = requestRef.current + 1;
    requestRef.current = request;

    if (args.active) return;

    samplesRef.current = [];
    noisyRef.current = false;
    // Reset after the effect so React Compiler can keep effects side-effectful
    // without treating this session boundary as a synchronous render update.
    queueMicrotask(() => {
      if (mountedRef.current && requestRef.current === request) {
        setNoisy(false);
        setReading(null);
      }
    });
  }, [args.active]);

  useEffect(() => {
    listeningRef.current = args.listening;
    // A song boundary divides conditions: a partial window cannot describe
    // either side of it, so discard it rather than blend two different rooms.
    if (!args.listening) samplesRef.current = [];
  }, [args.listening]);

  const observe = useCallback((rms: number) => {
    if (!activeRef.current || !listeningRef.current || noisyRef.current) return;

    const samples = samplesRef.current;
    samples.push(rms);
    if (samples.length < ROOM_WINDOW_SAMPLES) return;

    const nextReading = judgeRoom(samples);
    samplesRef.current = [];
    setReading(nextReading);

    if (nextReading.verdict === "noisy") {
      // One-way until karaoke closes, so the report describes the room the
      // evening was sung in rather than whichever quiet moment came last.
      noisyRef.current = true;
      setNoisy(true);
    }
  }, []);

  return { noisy, observe, reading };
}
