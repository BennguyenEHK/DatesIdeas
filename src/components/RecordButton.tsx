"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  startCallRecording,
  type CallRecording,
  type MixSources,
} from "@/lib/recording/mixer";
import { formatElapsed, MAX_RECORDING_MS } from "@/lib/recording/layout";
import { listRecordings } from "@/lib/recording/store";

export { type MixSources };

export function RecordButton({
  room,
  sources,
  onRecordingChange,
  onFinished,
}: {
  room: string;
  sources: MixSources;
  onRecordingChange: (on: boolean) => void;
  onFinished: (recording: {
    blob: Blob;
    mimeType: string;
    durationMs: number;
  }) => void;
}) {
  const recording = useRef<CallRecording | null>(null);
  const startedAt = useRef(0);
  const [on, setOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    void listRecordings(room).then((items) => {
      setCount(items.length);
    });
  }, [room]);

  const stop = useCallback(async () => {
    const active = recording.current;
    if (active === null) {
      return;
    }

    recording.current = null;
    setOn(false);
    onRecordingChange(false);

    const finished = await active.stop();
    if (finished !== null) {
      setCount((value) => value + 1);
      onFinished(finished);
    }
  }, [onFinished, onRecordingChange]);

  useEffect(() => {
    if (!on) {
      return;
    }

    const tick = window.setInterval(() => {
      setElapsed(Date.now() - startedAt.current);
    }, 250);
    const limit = window.setTimeout(() => {
      void stop();
    }, MAX_RECORDING_MS);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(limit);
    };
  }, [on, stop]);

  const toggle = () => {
    if (on) {
      void stop();
      return;
    }

    const next = startCallRecording(sources);
    if (next === null) {
      setUnavailable(true);
      return;
    }

    recording.current = next;
    startedAt.current = Date.now();
    setElapsed(0);
    setOn(true);
    onRecordingChange(true);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-label={
          unavailable
            ? "Recording is unavailable in this browser"
            : on
              ? "Stop recording"
              : "Start recording"
        }
        className={
          on || unavailable
            ? "relative inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs text-[var(--cream)] ring-1 ring-[var(--neon)]"
            : "inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--mist)] ring-1 ring-[var(--edge)] transition-colors hover:text-[var(--cream)] hover:ring-[var(--lamp)]"
        }
      >
        <span
          aria-hidden
          className={
            on
              ? "h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--neon)] shadow-[0_0_10px_var(--neon)]"
              : "h-3 w-3 rounded-full bg-[var(--neon)] shadow-[0_0_8px_var(--neon)]"
          }
        />
        {on ? <span>{formatElapsed(elapsed)}</span> : null}
        {unavailable ? (
          <span className="ml-1 text-[0.65rem]">Can’t record here</span>
        ) : null}
      </button>
      <Link
        href={`/recordings/${encodeURIComponent(room)}`}
        aria-label={
          count === 0 ? "View recordings" : `View ${count} recordings`
        }
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--mist)] ring-1 ring-[var(--edge)] transition-colors hover:text-[var(--cream)] hover:ring-[var(--lamp)]"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4 fill-none stroke-current"
          strokeWidth="1.7"
        >
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 4v2M20 12h-2M12 20v-2M4 12h2" />
        </svg>
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[var(--lamp)] px-1 text-center text-[0.6rem] text-[var(--letterbox)]">
            {count}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
