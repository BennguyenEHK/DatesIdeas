"use client";

/**
 * The calendar, open in the call for both of you. PLACEHOLDER -- the interface
 * is fixed; the body is being built.
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

export function RoomCalendar({ onClose }: RoomCalendarProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--mist)]">
      <p className="text-sm">The calendar is on its way.</p>
      <button type="button" onClick={onClose} className="text-xs text-[var(--lamp)] underline">
        Back to the call
      </button>
    </div>
  );
}
