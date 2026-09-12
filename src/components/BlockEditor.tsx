"use client";

import { useEffect, useRef, useState } from "react";
import { getDisplayName } from "@/lib/history/identity";
import {
  civilAt,
  instantFromCivil,
  REPEATS,
  type Repeat,
} from "@/lib/calendar/recur";
import type { TimeBlock } from "@/lib/calendar/blocks";

export interface BlockDraft {
  title: string;
  note: string | null;
  startsAt: string;
  endsAt: string;
  zone: string;
  owner: string;
  repeat: Repeat;
  repeatUntil: string | null;
  remindMinutes: number | null;
}

function blank(date: string, hour: number, zone: string): BlockDraft {
  const start = instantFromCivil(
    date,
    `${String(hour).padStart(2, "0")}:00`,
    zone,
  );
  const end = instantFromCivil(
    date,
    `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:00`,
    zone,
  );
  return {
    title: "",
    note: null,
    startsAt: start ?? "",
    endsAt: end ?? "",
    zone,
    owner: "both",
    repeat: "none",
    repeatUntil: null,
    remindMinutes: null,
  };
}

export function BlockEditor({
  block,
  initial,
  viewerZone,
  onSave,
  onDelete,
  onClose,
}: {
  block: TimeBlock | null;
  initial: { date: string; hour: number } | null;
  viewerZone: string;
  onSave: (draft: BlockDraft, id: string | null) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const source =
    block ?? (initial === null ? null : blank(initial.date, initial.hour, viewerZone));
  const [title, setTitle] = useState(source?.title ?? "");
  const [note, setNote] = useState(source?.note ?? "");
  const [start, setStart] = useState(
    source === null ? { date: "", time: "" } : civilAt(source.startsAt, viewerZone),
  );
  const [end, setEnd] = useState(
    source === null ? { date: "", time: "" } : civilAt(source.endsAt, viewerZone),
  );
  const [owner, setOwner] = useState(source?.owner ?? "both");
  const [repeat, setRepeat] = useState<Repeat>(source?.repeat ?? "none");
  const [repeatUntil, setRepeatUntil] = useState(source?.repeatUntil ?? "");
  const [reminder, setReminder] = useState(
    source?.remindMinutes === null || source === null
      ? ""
      : String(source.remindMinutes),
  );
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const displayName = getDisplayName();

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startsAt = instantFromCivil(start.date, start.time, viewerZone);
    const endsAt = instantFromCivil(end.date, end.time, viewerZone);
    if (startsAt === null || endsAt === null) {
      setError("Choose a start and end time.");
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError("End must be after the start.");
      return;
    }
    const failure = await onSave(
      {
        title,
        note: note.trim() === "" ? null : note,
        startsAt,
        endsAt,
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        owner,
        repeat,
        repeatUntil: repeatUntil === "" ? null : repeatUntil,
        remindMinutes: reminder === "" ? null : Number(reminder),
      },
      block?.id ?? null,
    );
    if (failure !== null) {
      setError(failure);
    }
  }

  if (source === null) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-[var(--letterbox)]/65 px-4 pt-20">
      <section
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={block === null ? "Add a time block" : "Edit time block"}
        className="w-full max-w-md border border-[var(--edge)] bg-[var(--letterbox)] p-5"
      >
        <p className="font-display text-xl text-[var(--cream)]">
          {block === null ? "Make time together" : "Shape the plan"}
        </p>
        <p className="mt-1 font-sans text-xs text-[var(--mist)]">
          Times are shown in {viewerZone}.
        </p>
        <form
          onSubmit={(event) => void save(event)}
          className="mt-4 grid gap-3"
        >
          <input
            aria-label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Dinner under the lights"
            className="h-10 border border-[var(--edge)] bg-[var(--night)] px-2 font-sans text-sm text-[var(--cream)]"
          />
          <textarea
            aria-label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note"
            rows={3}
            className="border border-[var(--edge)] bg-[var(--night)] p-2 font-sans text-sm text-[var(--cream)]"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 font-sans text-xs text-[var(--mist)]">
              Start
              <input
                aria-label="Start date"
                type="date"
                value={start.date}
                onChange={(event) =>
                  setStart({ ...start, date: event.target.value })
                }
                className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
              />
              <input
                aria-label="Start time"
                type="time"
                value={start.time}
                onChange={(event) =>
                  setStart({ ...start, time: event.target.value })
                }
                className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
              />
            </label>
            <label className="grid gap-1 font-sans text-xs text-[var(--mist)]">
              End
              <input
                aria-label="End date"
                type="date"
                value={end.date}
                onChange={(event) =>
                  setEnd({ ...end, date: event.target.value })
                }
                className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
              />
              <input
                aria-label="End time"
                type="time"
                value={end.time}
                onChange={(event) =>
                  setEnd({ ...end, time: event.target.value })
                }
                className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
              />
            </label>
          </div>
          <label className="grid gap-1 font-sans text-xs text-[var(--mist)]">
            Whose time
            <select
              aria-label="Owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
            >
              <option value="both">Both</option>
              {displayName !== null ? (
                <option value={displayName}>{displayName}</option>
              ) : null}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 font-sans text-xs text-[var(--mist)]">
              Repeat
              <select
                aria-label="Repeat"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value as Repeat)}
                className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
              >
                {REPEATS.map((value) => (
                  <option key={value} value={value}>
                    {value === "none" ? "Does not repeat" : value}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 font-sans text-xs text-[var(--mist)]">
              Repeat until
              <input
                aria-label="Repeat until"
                type="date"
                disabled={repeat === "none"}
                value={repeatUntil}
                onChange={(event) => setRepeatUntil(event.target.value)}
                className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)] disabled:opacity-40"
              />
            </label>
          </div>
          <label className="grid gap-1 font-sans text-xs text-[var(--mist)]">
            Reminder
            <select
              aria-label="Reminder"
              value={reminder}
              onChange={(event) => setReminder(event.target.value)}
              className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
            >
              <option value="">No reminder</option>
              <option value="10">10 min before</option>
              <option value="30">30 min before</option>
              <option value="60">1 hour before</option>
              <option value="1440">1 day before</option>
            </select>
          </label>
          {error !== null ? (
            <p role="alert" className="font-sans text-xs text-[var(--neon)]">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              className="font-sans text-sm text-[var(--lamp)] underline underline-offset-4"
            >
              {block === null ? "Save this time" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="font-sans text-sm text-[var(--mist)]"
            >
              Cancel
            </button>
            {block !== null ? (
              <button
                type="button"
                onClick={() => setDeleting(true)}
                className="ml-auto font-sans text-xs text-[var(--mist)] underline underline-offset-4"
              >
                Delete
              </button>
            ) : null}
          </div>
          {deleting && block !== null ? (
            <div className="border-t border-[var(--edge)] pt-3 font-sans text-xs text-[var(--mist)]">
              <p>Deleting this removes it from both of your calendars.</p>
              <button
                type="button"
                onClick={() =>
                  void onDelete(block.id).then((failure) => {
                    if (failure !== null) {
                      setError(failure);
                    }
                  })
                }
                className="mt-2 text-[var(--neon)] underline underline-offset-4"
              >
                Delete this time
              </button>
              <button
                type="button"
                onClick={() => setDeleting(false)}
                className="ml-4"
              >
                Keep it
              </button>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}
