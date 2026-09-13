"use client";

import { useEffect, useRef, useState } from "react";
import { moves, type AlbumItem } from "@/lib/album/types";

/**
 * One memory, in the picture.
 *
 * The album borrows the room's frame exactly: a CinemaScope still with every
 * control banished to the letterbox bars. Nothing is drawn on top of the
 * photograph, which is not restraint for its own sake -- it is the reason the
 * page can hold a portrait phone snap and a wide photo strip without either of
 * them acquiring furniture.
 */

function dayLabel(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    }).format(new Date(instant));
  } catch {
    // An unparseable instant is a broken row, not a broken page.
    return "";
  }
}

const NOUN: Record<AlbumItem["kind"], string> = {
  strip: "photo strip",
  clip: "live strip",
  photo: "photo",
  video: "video note",
  recording: "recording",
};

export function Projector({
  item,
  timeZone,
  onLove,
  onCaption,
  onDelete,
  onPlayDay,
  dayCount,
  empty,
}: {
  item: AlbumItem | null;
  timeZone: string;
  onLove: (item: AlbumItem, loved: boolean) => void;
  onCaption: (item: AlbumItem, caption: string | null) => void;
  onDelete: (item: AlbumItem) => void;
  onPlayDay?: () => void;
  dayCount?: number;
  empty?: "search";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [editingCaption, setEditingCaption] = useState(false);
  const [caption, setCaption] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Stop the outgoing video when the reel moves on. Without this, scrubbing
  // past three video notes leaves three of them playing audio at once, which
  // is a thing you only discover with headphones on.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      video?.pause();
    };
  }, [item?.id]);

  /** Saving on Enter and on blur must not be two different pieces of code. */
  function commitCaption() {
    // Declared above the empty-state return, so the narrowing there does not
    // reach it. Nothing can be captioned when there is nothing projected.
    if (item === null) return;
    onCaption(item, caption.trim() === "" ? null : caption.trim());
    setEditingCaption(false);
  }

  if (item === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display text-2xl text-[var(--cream)]">
          {empty === "search" ? "Find another memory" : "Nothing on the reel yet"}
        </p>
        <p className="max-w-xs font-sans text-sm leading-relaxed text-[var(--mist)]">
          {empty === "search"
            ? "Try a caption, a date like 2026-02, a month, or the name of a day you marked."
            : <>Share a photo to FestiBooth from your phone, or pick <span className="text-[var(--cream)]">Keep in the album</span> the next time the booth asks what to do with a strip.</>}
        </p>
      </div>
    );
  }

  return (
    <figure className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {moves(item.kind) ? (
          <video
            ref={videoRef}
            key={item.id}
            src={item.url}
            poster={item.posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- a signed,
             short-lived URL on a storage host the optimiser cannot fetch. */
          <img
            key={item.id}
            src={item.url}
            alt={item.caption ?? `A ${NOUN[item.kind]} from ${item.happenedAt}`}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      <figcaption className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-sans text-xs tracking-wide text-[var(--mist)]">
        <span>{dayLabel(item.happenedAt, timeZone)}</span>
        <span aria-hidden className="text-[var(--edge)]">
          |
        </span>
        <span>{NOUN[item.kind]}</span>
        {editingCaption ? (
          <input
            autoFocus
            aria-label="Caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            onKeyDown={(event) => {
              // Escape abandons the edit; Enter commits it. Both are what a
              // person expects from a field that appeared where text used to be.
              if (event.key === "Escape") setEditingCaption(false);
              if (event.key === "Enter") commitCaption();
            }}
            onBlur={commitCaption}
            className="h-7 border-b border-[var(--lamp)] bg-transparent px-1 text-[var(--cream)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setCaption(item.caption ?? "");
              setEditingCaption(true);
            }}
            aria-label="Edit caption"
            className="text-[var(--cream)] underline decoration-[var(--edge)] underline-offset-4 hover:decoration-[var(--lamp)]"
          >
            {item.caption ?? "Add a caption"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onLove(item, !item.loved)}
          aria-pressed={item.loved}
          aria-label={item.loved ? "Remove from loved" : "Love this"}
          className={
            item.loved
              ? "text-base text-[var(--lamp)]"
              : "text-base text-[var(--mist)] opacity-60 transition-opacity hover:opacity-100"
          }
        >
          <span aria-hidden>{item.loved ? "♥" : "♡"}</span>
        </button>
        {onPlayDay !== undefined && (dayCount ?? 0) >= 2 ? (
          <button
            type="button"
            onClick={onPlayDay}
            className="text-[var(--mist)] underline underline-offset-4 hover:text-[var(--cream)]"
          >
            ▶ Play this day
          </button>
        ) : null}
        {confirmingDelete ? (
          <span className="flex items-center gap-2">
            <span>This cannot be undone.</span>
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="text-[var(--neon)] underline underline-offset-4"
            >
              Delete it
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="text-[var(--mist)]"
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete this item"
            className="text-[var(--mist)] underline underline-offset-4 hover:text-[var(--cream)]"
          >
            Delete
          </button>
        )}
      </figcaption>
    </figure>
  );
}
