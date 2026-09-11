"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "./Wordmark";
import { Projector } from "./Projector";
import { Reel } from "./Reel";
import { buildReel } from "@/lib/album/timeline";
import { addToAlbum } from "@/lib/album/upload";
import { posterFromVideo } from "@/lib/album/poster";
import { moves, type AlbumItem, type AlbumKind, type Gear, type Occasion } from "@/lib/album/types";
import type { ListResponse } from "@/lib/album/wire";

/**
 * The album, once this browser is known.
 *
 * The layout is the room's, on purpose: a CinemaScope frame with the picture
 * in it and everything else in the letterbox bars above and below. The album
 * and the evening are the same place seen at different distances, and making
 * them look like two apps would be a lie about that.
 */

/**
 * Which zone the reel groups in.
 *
 * The viewer's own, and read here rather than inside `buildReel` so the
 * grouping stays a pure function of its arguments. The two people using this
 * are in different timezones by definition, so there is no single correct
 * answer -- only "the days as you live them", which is what each of you means
 * by "our Saturday".
 */
function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** What a picked file is, in the album's vocabulary. */
function kindForFile(file: File): AlbumKind | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

type Status =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "failed"; message: string };

type Fetched =
  | { ok: true; items: AlbumItem[]; occasions: Occasion[] }
  | { ok: false; message: string };

/**
 * Reads the album. Deliberately outside the component and holding no state of
 * its own: fetching and deciding what to show are different jobs, and keeping
 * them apart is what lets the effect below hand its result to a callback
 * rather than setting state in its own body.
 */
async function fetchAlbum(): Promise<Fetched> {
  try {
    const response = await fetch("/api/album", { credentials: "same-origin" });
    if (!response.ok) {
      return {
        ok: false,
        message:
          response.status === 401
            ? "This device is not paired yet."
            : "The album could not be opened just now.",
      };
    }
    const body = (await response.json()) as ListResponse;
    return { ok: true, items: body.items, occasions: body.occasions };
  } catch {
    return { ok: false, message: "The album could not be reached." };
  }
}

export function AlbumClient() {
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [gear, setGear] = useState<Gear>("frames");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  // Resolved once, as lazy initial state. The zone cannot change while the
  // page is open, so there is nothing to recompute and nothing to depend on.
  const [timeZone] = useState(viewerTimeZone);

  const apply = useCallback((fetched: Fetched) => {
    if (!fetched.ok) {
      setStatus({ state: "failed", message: fetched.message });
      return;
    }
    setItems(fetched.items);
    setOccasions(fetched.occasions);
    setStatus({ state: "ready" });
    setCurrentId((existing) => existing ?? fetched.items[0]?.id ?? null);
  }, []);

  useEffect(() => {
    // Cancelled rather than left to land: a reply arriving after the album has
    // been navigated away from would set state on a component nobody is
    // looking at, and in development would do it twice.
    let cancelled = false;
    void fetchAlbum().then((fetched) => {
      if (!cancelled) apply(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const view = useMemo(
    () => buildReel(items, occasions, gear, timeZone),
    [items, occasions, gear, timeZone],
  );

  const current = items.find((item) => item.id === currentId) ?? items[0] ?? null;

  // Threading is left to CSS rather than tracked here. `.reel-thread` is a
  // one-shot animation, so it plays when the class first lands on the element
  // and never again -- a render flag would only be a second, less reliable
  // copy of a fact the stylesheet already holds. Reading a ref during render
  // to decide it, which is what this was, is also simply not allowed.
  const shouldThread = status.state === "ready" && items.length > 0;

  /**
   * Loving something writes through immediately and shows immediately.
   *
   * The optimistic update is reverted on failure rather than left to drift.
   * A heart that silently did not save is worse than one that visibly refused:
   * the whole point of the mark is that you can trust it a year later.
   */
  const love = useCallback(async (item: AlbumItem, loved: boolean) => {
    setItems((previous) =>
      previous.map((candidate) =>
        candidate.id === item.id ? { ...candidate, loved } : candidate,
      ),
    );
    try {
      const response = await fetch(`/api/album/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ loved }),
      });
      if (!response.ok) throw new Error("refused");
    } catch {
      setItems((previous) =>
        previous.map((candidate) =>
          candidate.id === item.id ? { ...candidate, loved: !loved } : candidate,
        ),
      );
    }
  }, []);

  const add = useCallback(
    async (chosen: FileList | null) => {
      if (chosen === null || chosen.length === 0) return;
      const files = Array.from(chosen);

      // Sequential, not Promise.all. These are photographs and videos over a
      // phone's uplink; five at once is five that all crawl, and the person is
      // watching a counter either way.
      for (const [index, file] of files.entries()) {
        const kind = kindForFile(file);
        if (kind === null) continue;
        setBusy(`Adding ${index + 1} of ${files.length}…`);

        const poster = moves(kind) ? await posterFromVideo(file) : null;
        const result = await addToAlbum(file, {
          kind,
          contentType: file.type,
          // The file's own timestamp, not now. A photograph taken on Saturday
          // and shared on Tuesday belongs to Saturday.
          happenedAt: file.lastModified,
          poster,
        });

        if (!result.ok) {
          setBusy(null);
          setStatus({ state: "failed", message: result.error ?? "That did not save." });
          return;
        }
        if (result.item !== undefined) {
          const added = result.item;
          setItems((previous) => [added, ...previous]);
          setCurrentId(added.id);
        }
      }

      setBusy(null);
      if (filesRef.current !== null) filesRef.current.value = "";
    },
    [],
  );

  return (
    <div className="flex h-dvh flex-col bg-[var(--night)]">
      <header className="bar-top flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-[var(--letterbox)] px-5 py-3">
        <Wordmark size="compact" />
        <div className="flex items-center gap-4">
          {busy !== null ? (
            <span className="font-sans text-[11px] tracking-wide text-[var(--mist)]">
              {busy}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => filesRef.current?.click()}
            className="inline-flex h-8 items-center gap-2 rounded-full px-3 font-sans text-xs tracking-wide text-[var(--mist)] ring-1 ring-[var(--edge)] transition-colors hover:text-[var(--cream)] hover:ring-[var(--lamp)]/50"
          >
            <span aria-hidden>+</span> Add
          </button>
          <input
            ref={filesRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(event) => void add(event.target.files)}
          />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center px-4 py-4">
        {status.state === "loading" ? (
          <p className="font-sans text-sm text-[var(--mist)]">Opening the album…</p>
        ) : status.state === "failed" ? (
          <div className="max-w-xs text-center">
            <p className="font-sans text-sm text-[var(--cream)]">{status.message}</p>
            <button
              type="button"
              onClick={() => {
                setStatus({ state: "loading" });
                void fetchAlbum().then(apply);
              }}
              className="mt-4 font-sans text-xs tracking-wide text-[var(--lamp)] underline decoration-[var(--lamp)]/40 underline-offset-4"
            >
              Try again
            </button>
          </div>
        ) : (
          <Projector item={current} timeZone={timeZone} onLove={(i, l) => void love(i, l)} />
        )}
      </main>

      <footer className="bar-bottom bg-[var(--letterbox)] pb-3">
        <Reel
          view={view}
          currentItemId={current?.id ?? null}
          gear={gear}
          onSelect={setCurrentId}
          onGear={setGear}
          threading={shouldThread}
        />
      </footer>
    </div>
  );
}
