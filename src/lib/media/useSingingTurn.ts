"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** Sampling more often competes with the camera analysis without improving a turn. */
export const SINGING_SAMPLE_MS = 100;
/** A phrase must clear this level before it can claim the turn. */
export const SINGING_ON_RMS = 0.06;
/** A voice already holding the turn gets more room for breaths and tail ends. */
export const SINGING_OFF_RMS = 0.03;
/**
 * How long a voice must stay quiet before it gives the turn up.
 *
 * Deliberately longer than a phrase gap. Every change of turn moves the music,
 * and moving the music is the one thing this feature can be seen doing -- so
 * the cost of handing the turn over too eagerly is a stutter between verses,
 * while the cost of holding it too long is a second or two of delay nobody
 * asked for. The first is far more annoying than the second.
 */
export const SINGING_QUIET_HOLD_MS = 2500;

export interface SingingTurnState {
  mine: boolean;
  theirs: boolean;
  accept: (m: PeerMessage) => void;
}

/**
 * Reports which microphone is carrying a vocal line.
 *
 * The level itself stays local: only the settled answer crosses the call, so
 * one person's gain control cannot make the other person's music move.
 */
export function useSingingTurn(args: {
  stream: MediaStream | null;
  send: (m: PeerMessage) => void;
  enabled: boolean;
}): SingingTurnState {
  const [mine, setMine] = useState(false);
  const [theirs, setTheirs] = useState(false);

  // These all sit above the callbacks that write them. The React Compiler
  // otherwise rejects the write as a ref mutation captured below its hook.
  const mineRef = useRef(false);
  const quietSinceRef = useRef<number | null>(null);
  const sendRef = useRef(args.send);

  useEffect(() => {
    sendRef.current = args.send;
  }, [args.send]);

  const reportMine = useCallback((on: boolean) => {
    if (mineRef.current === on) return;
    mineRef.current = on;
    setMine(on);
    sendRef.current({ t: "singing", on });
  }, []);

  const accept = useCallback((m: PeerMessage) => {
    if (m.t !== "singing") return;
    setTheirs(m.on);
  }, []);

  useEffect(() => {
    if (!args.enabled || !args.stream) {
      reportMine(false);
      quietSinceRef.current = null;
      return;
    }

    const AudioContextConstructor = globalThis.AudioContext;
    if (typeof AudioContextConstructor !== "function") {
      reportMine(false);
      quietSinceRef.current = null;
      return;
    }

    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const stop = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
      try {
        source?.disconnect();
      } catch {
        // A half-built graph must not turn leaving karaoke into a broken call.
      }
      try {
        analyser?.disconnect();
      } catch {
        // A half-built graph must not turn leaving karaoke into a broken call.
      }
      try {
        void context?.close().catch(() => {});
      } catch {
        // A half-built graph must not turn leaving karaoke into a broken call.
      }
    };

    try {
      context = new AudioContextConstructor();
      source = context.createMediaStreamSource(args.stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);

      const sample = () => {
        if (stopped || analyser === null) return;
        try {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const value of samples) {
            const centered = (value - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / samples.length);

          if (!mineRef.current) {
            if (rms >= SINGING_ON_RMS) {
              quietSinceRef.current = null;
              reportMine(true);
            }
            return;
          }

          if (rms >= SINGING_OFF_RMS) {
            quietSinceRef.current = null;
            return;
          }

          const now = Date.now();
          if (quietSinceRef.current === null) {
            quietSinceRef.current = now;
          } else if (now - quietSinceRef.current >= SINGING_QUIET_HOLD_MS) {
            quietSinceRef.current = null;
            reportMine(false);
          }
        } catch {
          // Without a readable meter there is no honest turn to report.
          reportMine(false);
          stopped = true;
          stop();
        }
      };

      interval = setInterval(sample, SINGING_SAMPLE_MS);
    } catch {
      stop();
      reportMine(false);
    }

    return () => {
      stopped = true;
      stop();
      quietSinceRef.current = null;
      // A departed singer must release the turn or the listener stays delayed.
      reportMine(false);
      // And their last word was "still singing". If the call drops or karaoke
      // closes there is no second message coming to take it back, so forget it
      // here rather than leave a vanished singer holding this side's music.
      setTheirs(false);
    };
  }, [args.enabled, args.stream, reportMine]);

  return { mine, theirs, accept };
}
