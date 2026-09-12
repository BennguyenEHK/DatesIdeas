"use client";

import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/recording/layout";

export function RecordingReview({
  recording,
  onSave,
  onLove,
  onDiscard,
  busy = null,
  error = null,
}: {
  recording: { blob: Blob; mimeType: string; durationMs: number };
  onSave: () => void;
  onLove: () => void;
  onDiscard: () => void;
  busy?: string | null;
  error?: string | null;
}) {
  const [url] = useState(() => URL.createObjectURL(recording.blob));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDiscard();
      }
    };

    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
    };
  }, [onDiscard]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review recording"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--letterbox)]/95 p-5"
    >
      <div className="w-full max-w-3xl text-center">
        <h2 className="font-display text-3xl text-[var(--dress)]">
          Your take
        </h2>
        <p className="mt-1 text-sm text-[var(--mist)]">
          {formatElapsed(recording.durationMs)}
        </p>
        <video
          controls
          autoPlay
          src={url}
          className="mt-5 aspect-video w-full bg-[var(--night)] ring-1 ring-[var(--edge)]"
        />
        <div className="mt-5 flex flex-wrap justify-center gap-5">
          <button
            type="button"
            disabled={busy !== null}
            onClick={onSave}
            className="rounded-full px-5 py-2 text-sm text-[var(--cream)] shadow-[0_0_18px_var(--lamp)] ring-1 ring-[var(--lamp)] hover:bg-[var(--lamp)]/15"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={onLove}
            aria-label="Love this recording"
            className="rounded-full px-5 py-2 text-sm text-[var(--cream)] shadow-[0_0_18px_var(--neon)] ring-1 ring-[var(--neon)] hover:bg-[var(--neon)]/15"
          >
            Love it
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              if (confirming) {
                onDiscard();
                return;
              }

              setConfirming(true);
            }}
            className="rounded-full px-5 py-2 text-sm text-[var(--mist)] shadow-[0_0_14px_var(--edge)] ring-1 ring-[var(--edge)] hover:text-[var(--cream)]"
          >
            {confirming ? "Delete recording" : "Delete"}
          </button>
        </div>
        {busy !== null ? (
          <p className="mt-4 text-sm text-[var(--lamp)]">{busy}</p>
        ) : null}
        {error !== null ? (
          <p className="mt-4 text-sm text-[var(--neon)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
