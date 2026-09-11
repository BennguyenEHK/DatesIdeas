"use client";

import { useCallback, useEffect, useState } from "react";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push/subscribe";

/**
 * Switching the other phone's buzz on and off, from this device.
 *
 * Every state here is a different situation with a different remedy, so none
 * of them collapses into a generic failure. A person who taps this and sees
 * nothing happen has no way to find out why, and "nothing happened" is what a
 * single boolean would produce for four of the five outcomes below.
 */

const LABEL: Record<PushState, string> = {
  unsupported: "No notifications here",
  unconfigured: "Notifications not set up",
  denied: "Notifications blocked",
  granted: "Notifications on",
  off: "Notify me",
};

const EXPLAIN: Partial<Record<PushState, string>> = {
  unsupported: "This browser cannot receive them. Install the app to your home screen and try there.",
  unconfigured: "This copy of FestiBooth has no push keys, so nothing can be sent.",
  denied: "You turned these off for this site. Your browser's site settings is the only place that can turn them back on.",
};

export function NotificationToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pushState().then((current) => {
      if (!cancelled) setState(current);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    const next = state === "granted" ? await disablePush() : await enablePush();
    setState(next);
    setBusy(false);
  }, [state]);

  // Nothing until the answer is known. A button that says "Notify me" and then
  // silently becomes "blocked" a moment later reads as having been pressed.
  if (state === null) return null;

  const actionable = state === "off" || state === "granted";
  const explanation = EXPLAIN[state];

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!actionable || busy}
      title={explanation ?? LABEL[state]}
      aria-label={explanation ?? LABEL[state]}
      aria-pressed={state === "granted"}
      className={
        state === "granted"
          ? "inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-sans text-xs tracking-wide text-[var(--lamp)] ring-1 ring-[var(--lamp)]/50"
          : actionable
            ? "inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-sans text-xs tracking-wide text-[var(--mist)] ring-1 ring-[var(--edge)] transition-colors hover:text-[var(--cream)] hover:ring-[var(--lamp)]/40"
            : "inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full px-3 font-sans text-xs tracking-wide text-[var(--mist)] opacity-45 ring-1 ring-[var(--edge)]"
      }
    >
      <span aria-hidden>{state === "granted" ? "🔔" : "🔕"}</span>
      <span className="hidden sm:inline">{busy ? "…" : LABEL[state]}</span>
    </button>
  );
}
