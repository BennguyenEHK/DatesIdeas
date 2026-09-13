"use client";

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
}

export function RoomCalendar({ week, revision, onWeek, onChanged, onClose }: RoomCalendarProps) {
  const [unpaired, setUnpaired] = useState(false);
  const showUnpaired = useCallback(() => setUnpaired(true), []);

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
          <p className="mt-2 font-sans text-xs leading-5 text-[var(--mist)]">
            Open the album on the other device and scan the season ticket QR.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 border border-[var(--lamp)] px-3 py-2 font-sans text-xs
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
