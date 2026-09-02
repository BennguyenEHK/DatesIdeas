"use client";

import { Ambience } from "./Ambience";
import { Wordmark } from "./Wordmark";
import type { RoomStatus } from "@/lib/room/lifetime";

const COPY = {
  expired: {
    heading: "This evening has ended",
    body: "A room lasts a day, then its code stops working. Open a new one and send the link.",
  },
  missing: {
    heading: "No room with that code",
    body: "Codes are six characters and last a day. Check it over, or open a new room.",
  },
} as const;

/**
 * Where a dead link lands.
 *
 * Without this, a closed room is indistinguishable from a partner who has not
 * arrived yet — the same quiet "waiting", forever. Saying which of the two it
 * is, and why, is the whole job.
 */
export function RoomClosed({
  status,
  code,
  onStart,
  pending,
  error,
}: {
  status: Exclude<RoomStatus, "open">;
  code: string;
  onStart: () => void;
  pending: boolean;
  error?: string | null;
}) {
  const { heading, body } = COPY[status];

  return (
    <>
      <Ambience />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-10 px-6 py-16 text-center">
        <div className="rise flex flex-col items-center gap-5">
          <Wordmark size="hero" />
          <span className="h-px w-20 bg-[var(--lamp)]/45" />
        </div>

        <div className="rise-late flex flex-col gap-4">
          <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-[0.12em] text-[var(--cream)]">
            {heading}
          </h1>
          <p className="text-sm leading-relaxed text-[var(--mist)]">{body}</p>
          <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.5em] text-[var(--lamp)]/70">
            {code}
          </p>
        </div>

        <div className="rise-late flex flex-col gap-3">
          <button
            onClick={onStart}
            disabled={pending}
            className="w-full rounded-[2px] bg-[var(--dress)] px-6 py-3.5 text-sm font-medium tracking-wide text-[#1a1405] transition-colors hover:bg-[var(--lamp)] disabled:cursor-not-allowed disabled:bg-[var(--mist)]/30 disabled:text-[var(--mist)]"
          >
            {pending ? "Opening a room…" : "Start a new evening"}
          </button>
          {error && (
            <p role="alert" className="text-xs text-[var(--neon)]">
              {error}
            </p>
          )}
        </div>
      </main>
    </>
  );
}
