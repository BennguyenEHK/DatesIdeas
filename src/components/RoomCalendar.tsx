"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { CalendarClient } from "@/components/CalendarClient";

/**
 * The calendar, open in the call for both of you, with your faces beside it.
 *
 * The week showing comes from `week`, which both screens share; CalendarClient
 * reports the person's own moves through `onWeek`. Each screen loads its own
 * blocks with its own season ticket and reloads when `revision` goes up.
 */
export interface RoomCalendarProps {
  /** The week both screens show, as the ISO instant it starts, or null for this week. */
  week: string | null;
  /** Goes up when the other screen changed a time block. Reload when it does. */
  revision: number;
  /** Call only when this person moves to another week. */
  onWeek: (start: string) => void;
  /** Call after this person adds, edits or deletes a time block. */
  onChanged: () => void;
  /** Back to the call, for both of you. */
  onClose: () => void;
  /** This device is being put on the album by the other screen right now. */
  joining?: boolean;
  /** Why joining the album from the other screen failed, or null. */
  joinError?: string | null;
  /** Asks the other screen to let this device in again. */
  onRetryJoin?: () => void;
  /**
   * False when nobody in the room is on an album, so there is nobody to be let
   * in by and the only way forward is to start one.
   */
  canBeInvited?: boolean;
}

export function RoomCalendar({
  week,
  revision,
  onWeek,
  onChanged,
  onClose,
  joining = false,
  joinError = null,
  onRetryJoin,
  canBeInvited,
}: RoomCalendarProps) {
  // The revision the calendar was refused at, rather than a flag. The refusal
  // unmounts CalendarClient, so nothing would ever ask again; tying it to the
  // revision means the room bumping it -- after this device has joined the
  // album -- mounts the calendar afresh and it loads with the new ticket.
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const showUnpaired = useCallback(() => setRefusedAt(revision), [revision]);
  const unpaired = refusedAt === revision;

  if (unpaired && joining) {
    return (
      <section
        className="flex h-full min-h-0 flex-col items-center justify-center bg-[var(--letterbox)]
          px-5 text-center"
      >
        <p role="status" className="font-sans text-sm text-[var(--mist)]">
          Getting you in…
        </p>
      </section>
    );
  }

  if (unpaired && joinError !== null) {
    return (
      <section
        className="flex h-full min-h-0 flex-col items-center justify-center bg-[var(--letterbox)]
          px-5 text-center"
      >
        <div className="max-w-sm border-y border-[var(--edge)] py-6">
          <p className="font-sans text-sm text-[var(--mist)]">{joinError}</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRetryJoin}
              className="border border-[var(--lamp)] px-3 py-2 font-sans text-xs text-[var(--lamp)]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border border-[var(--edge)] px-3 py-2 font-sans text-xs text-[var(--mist)]"
            >
              Back to the call
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (unpaired) {
    return (
      <section
        className="flex h-full min-h-0 flex-col items-center justify-center bg-[var(--letterbox)]
          px-5 text-center"
      >
        <div className="max-w-sm border-y border-[var(--edge)] py-6">
          <p className="font-display text-xl text-[var(--cream)]">
            This device isn&apos;t on your calendar yet.
          </p>
          {canBeInvited === false ? (
            <Link
              href="/us/new"
              className="mt-3 inline-block font-sans text-xs text-[var(--lamp)] underline
                underline-offset-4"
            >
              Set up your album
            </Link>
          ) : (
            <p className="mt-2 font-sans text-xs leading-5 text-[var(--mist)]">
              Open the album on the other device and scan the season ticket QR.
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mt-5 block mx-auto border border-[var(--lamp)] px-3 py-2 font-sans text-xs
              text-[var(--lamp)]"
          >
            Back to the call
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-[var(--letterbox)]">
      <CalendarClient
        week={week}
        onWeekChange={onWeek}
        revision={revision}
        onChanged={onChanged}
        compact
        onUnpaired={showUnpaired}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute bottom-2 left-2 z-20 border border-[var(--edge)] bg-[var(--letterbox)]/90
          px-2 py-1 font-sans text-[10px] text-[var(--mist)] backdrop-blur-sm
          hover:border-[var(--lamp)] hover:text-[var(--lamp)]"
      >
        Back to the call
      </button>
    </section>
  );
}
