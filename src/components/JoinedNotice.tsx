"use client";

import { useEffect } from "react";

/** How long the line stays if nobody dismisses it. */
export const JOINED_NOTICE_MS = 30_000;

/**
 * "A new device joined your album", with Undo.
 *
 * Whoever joins your room joins your album, without a tap on either side. This
 * line is what keeps that from happening behind anyone's back: it names the
 * moment on the inviting screen and offers the one thing to do about it. It
 * goes by itself after thirty seconds, because a join the two of you expected
 * should not leave a banner on the call for the rest of the evening.
 *
 * The room mounts it keyed by the device, so a second join restarts the clock.
 */
export function JoinedNotice({ onUndo, onDismiss }: { onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, JOINED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 border-b border-[var(--edge)]
        bg-[var(--letterbox)] px-5 py-2 font-sans text-xs text-[var(--cream)]"
    >
      <span>A new device joined your album</span>
      <button
        type="button"
        onClick={onUndo}
        aria-label="Undo: remove that device from the album"
        className="text-[var(--lamp)] underline underline-offset-4"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-[var(--mist)] hover:text-[var(--cream)]"
      >
        ×
      </button>
    </div>
  );
}
