"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildReel } from "@/lib/album/timeline";
import { addToAlbum } from "@/lib/album/upload";
import { GEARS, moves, type AlbumItem, type AlbumKind, type Occasion } from "@/lib/album/types";
import type { ListResponse } from "@/lib/album/wire";
import type { AlbumView } from "@/lib/together/useTogether";
import { formatAlbumDate } from "./room-album/format";
import { ReelStack } from "./ReelStack";
import { DayFilm } from "./DayFilm";
import { dayFilmFacts } from "@/lib/album/dayFilmFacts";
import {
  dayItems,
  filmElapsed,
  pauseFilm,
  resumeFilm,
  seekFilm,
  startFilm,
  type FilmState,
} from "@/lib/album/film";
import { civilDate } from "@/lib/album/occasions";

const NO_FILM = () => undefined;

/**
 * The album, open in the call for both of you, with your faces beside it.
 *
 * What is showing comes from `view`, which both screens share; this component
 * only reports the person's own moves through `onView`. Each screen loads the
 * album itself with its own season ticket and reloads when `revision` goes up.
 */
export interface RoomAlbumProps {
  /** Where both screens are. Follow it; never echo it back through onView. */
  view: AlbumView;
  /** Goes up when the other screen changed the album. Reload when it does. */
  revision: number;
  /** Call only for this person's own navigation. */
  onView: (view: AlbumView) => void;
  /** Call after this person adds, captions, loves or deletes something. */
  onChanged: () => void;
  /** Back to the call, for both of you. */
  onClose: () => void;
  /** The film of a day playing on both screens, or null. */
  film?: FilmState | null;
  /** Call only for this person's own film actions: start, pause, resume, seek, close. */
  onFilm?: (next: FilmState | null) => void;
  /** The shared clock the film is anchored to. */
  now?: () => number;
  /** How far ahead a start is anchored, so both screens begin on the same frame. */
  filmLeadMs?: number;
}

type LoadState = "loading" | "ready" | "unauthorized" | "failed";

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function kindFor(file: File): AlbumKind | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export function RoomAlbum({
  view,
  revision,
  onView,
  onChanged,
  onClose,
  film = null,
  onFilm = NO_FILM,
  now = Date.now,
  filmLeadMs = 0,
}: RoomAlbumProps) {
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  // The item whose caption is being typed. Tied to an id rather than a flag, so
  // the other screen moving on closes the box instead of saving the words onto
  // whichever photograph is showing by the time Save is pressed.
  const [captionFor, setCaptionFor] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [timeZone] = useState(viewerTimeZone);

  const reload = useCallback(async () => {
    // Only the first load blanks the frame. A reload because the other screen
    // loved or captioned something keeps the photograph -- and a video that is
    // playing -- exactly where it is while the fresh list arrives.
    setState((previous) => (previous === "ready" ? "ready" : "loading"));
    try {
      const response = await fetch("/api/album", { credentials: "same-origin" });
      if (response.status === 401) {
        setState("unauthorized");
        return;
      }
      if (!response.ok) throw new Error("album request failed");
      const body = (await response.json()) as ListResponse;
      setItems(body.items);
      setOccasions(Array.isArray(body.occasions) ? body.occasions : []);
      setState("ready");
    } catch {
      setMessage("The album could not be opened just now.");
      setState("failed");
    }
  }, []);

  useEffect(() => {
    // Queue the request after the effect has committed. `reload` then owns the
    // state transition when the request begins and completes.
    void Promise.resolve().then(reload);
  }, [reload, revision]);

  const ordered = useMemo(
    () => buildReel(items, [], view.gear, timeZone).frames,
    [items, timeZone, view.gear],
  );
  const shown = items.find((item) => item.id === view.itemId) ?? ordered[0]?.item ?? null;
  const day = shown === null ? null : civilDate(shown.happenedAt, timeZone);
  const dayCount = useMemo(
    () => (day === null ? 0 : dayItems(items, day, timeZone).length),
    [day, items, timeZone],
  );
  const filmFacts = useMemo(
    () => (film === null ? null : dayFilmFacts(items, occasions, film.day, timeZone)),
    [film, items, occasions, timeZone],
  );

  useEffect(() => {
    if (shown === null || strip.current === null) return;
    const thumbnail = strip.current.querySelector<HTMLElement>(`[data-item-id="${shown.id}"]`);
    thumbnail?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [shown]);

  const select = useCallback(
    (itemId: string) => onView({ itemId, gear: view.gear }),
    [onView, view.gear],
  );

  const step = useCallback(
    (direction: number) => {
      // Through the film strip as it is drawn, so previous and next move one
      // thumbnail along in every gear rather than through the raw list.
      if (shown === null) return;
      const position = ordered.findIndex((frame) => frame.item.id === shown.id);
      const next = ordered[position + direction];
      if (next !== undefined) select(next.item.id);
    },
    [ordered, select, shown],
  );

  const patch = useCallback(
    async (item: AlbumItem, update: { loved?: boolean; caption?: string | null }) => {
      setBusy(true);
      try {
        const response = await fetch(`/api/album/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(update),
        });
        if (!response.ok) throw new Error("album update failed");
        setItems((previous) =>
          previous.map((candidate) =>
            candidate.id === item.id ? { ...candidate, ...update } : candidate,
          ),
        );
        onChanged();
        return true;
      } catch {
        setMessage("That change did not save.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const saveCaption = useCallback(async () => {
    if (shown === null || captionFor !== shown.id) return;
    const saved = await patch(shown, { caption: captionValue.trim() || null });
    if (saved) setCaptionFor(null);
  }, [captionFor, captionValue, patch, shown]);

  const add = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      const kind = file === undefined ? null : kindFor(file);
      if (file === undefined || kind === null) return;
      setBusy(true);
      const result = await addToAlbum(file, {
        kind,
        contentType: file.type,
        happenedAt: file.lastModified,
      });
      setBusy(false);
      if (!result.ok) {
        setMessage(result.error ?? "That file did not save.");
      } else {
        await reload();
        onChanged();
      }
      if (fileInput.current !== null) fileInput.current.value = "";
    },
    [onChanged, reload],
  );

  return (
    <section
      aria-label="Shared album"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          step(-1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          step(1);
        }
      }}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--letterbox)] text-[var(--cream)] outline-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--edge)] px-3 py-2">
        <p className="font-display text-sm tracking-[0.16em] text-[var(--lamp)]">OUR REEL</p>
        <div className="flex items-center gap-2 text-xs">
          <div
            className="hidden rounded-full border border-[var(--edge)] p-0.5 sm:flex"
            aria-label="Reel scale"
          >
            {GEARS.map((gear) => (
              <button
                key={gear}
                type="button"
                aria-pressed={view.gear === gear}
                onClick={() => onView({ itemId: shown?.id ?? null, gear })}
                className="rounded-full px-2 py-1 capitalize text-[var(--mist)] aria-pressed:bg-[var(--lamp)]/20 aria-pressed:text-[var(--cream)]"
              >
                {gear}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--lamp)] underline underline-offset-4"
          >
            Back to the call
          </button>
        </div>
      </header>

      {state === "loading" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--mist)]">
          Opening the album…
        </div>
      ) : state === "unauthorized" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-[var(--cream)]">This device isn&apos;t on your album yet.</p>
          <p className="mt-2 max-w-xs text-xs text-[var(--mist)]">
            Open the album on the other device and scan the season ticket QR.
          </p>
        </div>
      ) : state === "failed" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-[var(--mist)]">{message}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="text-xs text-[var(--lamp)] underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      ) : shown === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--mist)]">
          Add the first memory to this reel.
        </div>
      ) : (
        <>
          <main className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-3">
            <button
              type="button"
              aria-label="Previous memory"
              onClick={() => step(-1)}
              className="absolute left-2 z-10 hidden border border-[var(--edge)] bg-[var(--letterbox)]/80 px-2 py-1 text-[var(--lamp)] sm:block"
            >
              ‹
            </button>
            {moves(shown.kind) ? (
              <video
                controls
                playsInline
                poster={shown.posterUrl ?? undefined}
                src={shown.url}
                className="h-full max-h-full w-full object-contain"
              />
            ) : (
              <img
                src={shown.url}
                alt={shown.caption ?? "Album memory"}
                className="h-full max-h-full w-full object-contain"
              />
            )}
            <button
              type="button"
              aria-label="Next memory"
              onClick={() => step(1)}
              className="absolute right-2 z-10 hidden border border-[var(--edge)] bg-[var(--letterbox)]/80 px-2 py-1 text-[var(--lamp)] sm:block"
            >
              ›
            </button>
          </main>
          <div className="shrink-0 border-t border-[var(--edge)] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--mist)]">{formatAlbumDate(shown.happenedAt)}</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void patch(shown, { loved: !shown.loved })}
                  className="text-sm text-[var(--lamp)] disabled:opacity-50"
                  aria-label={shown.loved ? "Unlove memory" : "Love memory"}
                >
                  {shown.loved ? "♥" : "♡"}
                </button>
                {day !== null && dayCount >= 2 ? (
                  <button
                    type="button"
                    // Anchored a little ahead on the shared clock, so the film
                    // begins on the same frame on both screens.
                    onClick={() => onFilm(startFilm(day, now() + filmLeadMs))}
                    className="text-xs text-[var(--lamp)]"
                  >
                    ▶ Play this day
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                  className="text-xs text-[var(--lamp)]"
                >
                  + Add
                </button>
              </div>
            </div>
            {captionFor === shown.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveCaption();
                }}
                className="mt-1 flex gap-2"
              >
                <input
                  autoFocus
                  value={captionValue}
                  onChange={(event) => setCaptionValue(event.target.value)}
                  className="min-w-0 flex-1 border-b border-[var(--lamp)] bg-transparent text-sm outline-none"
                  aria-label="Caption"
                />
                <button type="submit" className="text-xs text-[var(--lamp)]">
                  Save
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCaptionValue(shown.caption ?? "");
                  setCaptionFor(shown.id);
                }}
                className="mt-1 max-w-full truncate text-left text-sm text-[var(--cream)]"
              >
                {shown.caption ?? "Add a caption"}
              </button>
            )}
            {message !== "" && (
              <p role="status" className="mt-1 text-xs text-[var(--neon)]">
                {message}
              </p>
            )}
          </div>
          <footer className="reel shrink-0">
            <div
              ref={strip}
              className="reel-track h-16 px-2 sm:h-[4.5rem]"
              // The same signal the album page's reel sends: a stack's fan
              // follows or closes when the strip scrolls under it.
              onScroll={() => window.dispatchEvent(new Event("reel-stack-close"))}
            >
              {ordered.map((frame, index) =>
                view.gear !== "frames" && frame.count > 1 ? (
                  <div key={frame.key} data-item-id={frame.item.id} className="flex items-end">
                    <ReelStack
                      frame={frame}
                      index={index}
                      selected={shown.id === frame.item.id}
                      onSelect={select}
                    />
                  </div>
                ) : (
                  <button
                    key={frame.key}
                    type="button"
                    data-item-id={frame.item.id}
                    aria-current={shown.id === frame.item.id}
                    aria-label={`Show ${formatAlbumDate(frame.item.happenedAt)}`}
                    onClick={() => select(frame.item.id)}
                    className="reel-frame h-full w-16 sm:w-20"
                    data-loved={frame.loved}
                  >
                    <img
                      src={frame.item.posterUrl ?? frame.item.url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {frame.count > 1 && (
                      <span className="absolute bottom-0 right-0 bg-[var(--letterbox)] px-1 text-[10px] text-[var(--cream)]">
                        {frame.count}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
          </footer>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(event) => void add(event.target.files)}
          />
        </>
      )}
      {film !== null && filmFacts !== null && filmFacts.items.length > 0 ? (
        // The transform makes this box the film's containing block, so its
        // `fixed inset-0` fills the album frame instead of the whole screen
        // and the faces beside it stay in view.
        <div className="absolute inset-0 z-30" style={{ transform: "translateZ(0)" }}>
          <DayFilm
            {...filmFacts}
            elapsedMs={() => filmElapsed(film, now())}
            playing={film.pausedAtMs === null}
            onPause={() => onFilm(pauseFilm(film, now()))}
            onResume={() => onFilm(resumeFilm(film, now()))}
            onSeek={(elapsedMs) => onFilm(seekFilm(film, elapsedMs, now()))}
            onClose={() => onFilm(null)}
          />
        </div>
      ) : null}
    </section>
  );
}
