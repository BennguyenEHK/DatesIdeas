"use client";

import { useEffect, useRef } from "react";
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
}: {
  item: AlbumItem | null;
  timeZone: string;
  onLove: (item: AlbumItem, loved: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Stop the outgoing video when the reel moves on. Without this, scrubbing
  // past three video notes leaves three of them playing audio at once, which
  // is a thing you only discover with headphones on.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      video?.pause();
    };
  }, [item?.id]);

  if (item === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display text-2xl text-[var(--cream)]">
          Nothing on the reel yet
        </p>
        <p className="max-w-xs font-sans text-sm leading-relaxed text-[var(--mist)]">
          Share a photo to FestiBooth from your phone, or pick{" "}
          <span className="text-[var(--cream)]">Keep in the album</span> the next
          time the booth asks what to do with a strip.
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

      <figcaption className="flex items-center gap-3 font-sans text-xs tracking-wide text-[var(--mist)]">
        <span>{dayLabel(item.happenedAt, timeZone)}</span>
        <span aria-hidden className="text-[var(--edge)]">
          |
        </span>
        <span>{NOUN[item.kind]}</span>
        {item.caption !== null && item.caption !== "" ? (
          <span className="text-[var(--cream)]">{item.caption}</span>
        ) : null}
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
      </figcaption>
    </figure>
  );
}
