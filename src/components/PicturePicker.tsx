"use client";

import { useEffect, useState } from "react";
import type { AlbumItem } from "@/lib/album/types";

function isAlbumItems(value: unknown): value is AlbumItem[] {
  return Array.isArray(value);
}

export function PicturePicker({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (id: string | null) => void;
}) {
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let active = true;

    void fetch("/api/album", { credentials: "same-origin" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setLocked(true);
          return;
        }
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (active && isAlbumItems(body)) setItems(body);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="Choose a picture">
      <button
        type="button"
        aria-label="Blank page"
        aria-pressed={value === null}
        onClick={() => onPick(null)}
        className="shrink-0 border border-[var(--edge)] bg-[var(--cream)] px-3 py-2 text-xs
          text-[var(--night)] outline-offset-2 focus-visible:outline focus-visible:outline-2
          focus-visible:outline-[var(--lamp)]"
      >
        Blank page
      </button>
      {!locked && (
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Use album picture from ${item.happenedAt}`}
              aria-pressed={value === item.id}
              onClick={() => onPick(item.id)}
              className="h-11 w-15 shrink-0 overflow-hidden border border-[var(--edge)] outline-offset-2
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lamp)]"
            >
              {/* A signed URL is already minted for this exact album response. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.posterUrl ?? item.url}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {locked && (
        <p className="text-xs leading-snug text-[var(--mist)]">
          The album needs this device to hold a season ticket.
        </p>
      )}
    </div>
  );
}
