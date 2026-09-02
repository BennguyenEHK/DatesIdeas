"use client";

import { useEffect, useRef, useState } from "react";

const SETTLE_MS = 2200;

type State = "idle" | "copied" | "manual";

/**
 * The room's code, and the link that skips having to type it.
 *
 * The code stays visible rather than being hidden behind the button: it is
 * still the thing you read out loud when the link will not go through, and it
 * is what the other person sees in their own top bar.
 *
 * Sits in the letterbox bar with everything else, so it never covers the film.
 */
export function CopyLink({
  code,
  closesIn,
}: {
  code: string;
  closesIn: string | null;
}) {
  const [state, setState] = useState<State>("idle");
  const field = useRef<HTMLInputElement>(null);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/room/${code}`;

  useEffect(() => {
    if (state !== "copied") return;
    const id = setTimeout(() => setState("idle"), SETTLE_MS);
    return () => clearTimeout(id);
  }, [state]);

  // Select the fallback field as it appears, so the manual path is one
  // keystroke rather than a careful drag across six characters.
  useEffect(() => {
    if (state === "manual") field.current?.select();
  }, [state]);

  async function copy() {
    try {
      // Absent entirely over plain http, and refusable even where it exists.
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("manual");
    }
  }

  if (state === "manual") {
    return (
      <span className="flex items-center gap-2">
        <label htmlFor="room-link" className="sr-only">
          Copy this link and send it
        </label>
        <input
          id="room-link"
          ref={field}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-56 rounded-[2px] border border-[var(--lamp)]/40 bg-[rgba(8,11,28,0.8)] px-2 py-1 text-xs text-[var(--cream)]"
        />
      </span>
    );
  }

  return (
    <span className="flex items-center gap-3">
      {closesIn && (
        <span className="hidden text-[0.65rem] uppercase tracking-[0.25em] text-[var(--mist)] sm:inline">
          Closes in {closesIn}
        </span>
      )}
      <button
        onClick={copy}
        aria-label={`Copy the link to room ${code}`}
        className="group flex items-center gap-2.5 rounded-[2px] border border-transparent px-2 py-1 transition-colors hover:border-[var(--lamp)]/40"
      >
        <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.45em] text-[var(--lamp)]">
          {code}
        </span>
        <span className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--mist)] transition-colors group-hover:text-[var(--dress)]">
          {state === "copied" ? "Link copied" : "Copy link"}
        </span>
      </button>
    </span>
  );
}
