"use client";

import { useEffect, useRef, useState } from "react";
import type { Occasion } from "@/lib/album/types";

/**
 * Naming a day.
 *
 * An occasion is a title pinned to a date, and nothing is ever filed into one:
 * anything that happened that day joins it by arithmetic. That is why this
 * panel has no "add photos to this occasion" anywhere, and why naming a day
 * months later quietly gathers the photographs already sitting on it.
 *
 * It also means deleting one is safe, which is the single most important thing
 * this panel has to communicate. People hesitate over a delete button next to
 * their photographs, and they are right to — so it says so, in place, rather
 * than trusting anyone to have read it elsewhere.
 */

type Draft = Pick<Occasion, "title" | "onDate" | "yearly">;

const BLANK: Draft = { title: "", onDate: "", yearly: false };

/** The server's own sentence, when it has one. It is better than ours. */
async function message(response: Response): Promise<string | null> {
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : "The day could not be saved.";
}

export function OccasionEditor({
  occasions,
  onChange,
}: {
  occasions: Occasion[];
  onChange: (occasions: Occasion[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Click away and Escape close it, which is what every menu on every machine
  // already does and therefore what hands expect without being told. Same
  // pattern as SaveMenu, deliberately.
  useEffect(() => {
    if (!open) return;

    const away = (event: MouseEvent) => {
      if (box.current !== null && !box.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const existing =
      editing === null ? null : occasions.find((occasion) => occasion.id === editing) ?? null;

    const response = await fetch("/api/occasions", {
      method: existing === null ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(existing === null ? draft : { id: existing.id, ...draft }),
    });

    const failure = await message(response);
    if (failure !== null) {
      setError(failure);
      return;
    }

    if (existing === null) {
      const body = (await response.json()) as { occasion: Occasion };
      onChange([...occasions, body.occasion]);
    } else {
      onChange(
        occasions.map((occasion) =>
          occasion.id === existing.id ? { ...occasion, ...draft } : occasion,
        ),
      );
    }

    setDraft(BLANK);
    setEditing(null);
  }

  async function remove(id: string) {
    setError(null);
    const response = await fetch(`/api/occasions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });

    const failure = await message(response);
    if (failure !== null) {
      setError(failure);
      return;
    }

    onChange(occasions.filter((occasion) => occasion.id !== id));
    setDeleting(null);
  }

  function edit(occasion: Occasion) {
    setEditing(occasion.id);
    setDraft({ title: occasion.title, onDate: occasion.onDate, yearly: occasion.yearly });
    setError(null);
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="h-8 rounded-full px-3 font-sans text-xs text-[var(--mist)] ring-1 ring-[var(--edge)] transition-colors hover:text-[var(--cream)] hover:ring-[var(--lamp)]/50"
      >
        Name this day
      </button>

      {open ? (
        <section
          role="dialog"
          aria-label="Name a day"
          className="absolute right-0 top-full z-20 mt-2 w-80 border border-[var(--edge)] bg-[var(--letterbox)] p-4 shadow-[0_18px_36px_-20px_var(--night)]"
        >
          {/* The display face, because a heading here is identity rather than
              data -- the same rule the reel's leader tape follows. */}
          <p className="font-display text-lg text-[var(--cream)]">Days worth remembering</p>

          <form onSubmit={(event) => void save(event)} className="mt-3 grid gap-2">
            <input
              aria-label="Occasion name"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Our first evening"
              className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 font-sans text-sm text-[var(--cream)]"
            />
            <input
              aria-label="Occasion date"
              type="date"
              value={draft.onDate}
              onChange={(event) => setDraft({ ...draft, onDate: event.target.value })}
              className="h-9 border border-[var(--edge)] bg-[var(--night)] px-2 font-sans text-sm text-[var(--cream)]"
            />
            <label className="flex items-center gap-2 font-sans text-xs text-[var(--mist)]">
              <input
                type="checkbox"
                checked={draft.yearly}
                onChange={(event) => setDraft({ ...draft, yearly: event.target.checked })}
              />
              Repeats every year
            </label>

            {error !== null ? (
              <p role="alert" className="font-sans text-xs text-[var(--neon)]">
                {error}
              </p>
            ) : null}

            <div className="flex gap-3">
              <button
                type="submit"
                className="font-sans text-xs text-[var(--lamp)] underline underline-offset-4"
              >
                {editing === null ? "Name this day" : "Save this day"}
              </button>
              {editing !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setDraft(BLANK);
                  }}
                  className="font-sans text-xs text-[var(--mist)]"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <ul className="mt-4 border-t border-[var(--edge)] pt-3">
            {occasions.map((occasion) => (
              <li key={occasion.id} className="mb-3 font-sans text-xs text-[var(--mist)]">
                <div className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="text-[var(--cream)]">{occasion.title}</span>{" "}
                    {occasion.onDate}
                    {occasion.yearly ? ", every year" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => edit(occasion)}
                    aria-label={`Edit ${occasion.title}`}
                    className="text-[var(--lamp)]"
                  >
                    Edit
                  </button>
                </div>

                {deleting === occasion.id ? (
                  <div className="mt-2">
                    {/* The sentence this whole panel exists to be able to say. */}
                    <p>
                      Deleting this only forgets the name. Your photographs from that
                      day stay in the album.
                    </p>
                    <button
                      type="button"
                      onClick={() => void remove(occasion.id)}
                      className="mt-1 text-[var(--neon)] underline underline-offset-4"
                    >
                      Forget this name
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(null)}
                      className="ml-3 text-[var(--mist)]"
                    >
                      Keep it
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleting(occasion.id)}
                    aria-label={`Delete ${occasion.title}`}
                    className="mt-1 text-[var(--mist)] underline underline-offset-4"
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
