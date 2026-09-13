"use client";

import { useCallback, useRef, useState } from "react";
import type { FilmState } from "@/lib/album/film";
import type { Gear } from "@/lib/album/types";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** Which photograph, in which view, the album open in the call is showing. */
export interface AlbumView {
  itemId: string | null;
  gear: Gear;
}

export const START_VIEW: AlbumView = { itemId: null, gear: "frames" };

/**
 * The order two film changes settle in: the later stamp, and on a tie the
 * larger serialised state. Both screens compare the same way, so both keep the
 * same one however the two messages cross.
 */
function filmKey(film: FilmState | null, sentAt: number): [number, string] {
  return [sentAt, JSON.stringify(film)];
}

function later(candidate: [number, string], current: [number, string]): boolean {
  return candidate[0] !== current[0] ? candidate[0] > current[0] : candidate[1] > current[1];
}

/**
 * The album and the calendar, looked at together in the call.
 *
 * Only positions cross: which photograph, which view, which week, and the film
 * of a day. Each browser loads the album and the calendar itself with its own
 * season ticket, so a change -- a photograph added, a time block moved --
 * crosses as a bare notice and the other side reloads. The revision numbers
 * count those notices; a view reloads whenever its revision goes up.
 *
 * `showAlbum`, `showWeek` and `setFilm` are for the person's own actions only.
 * A view that called them in response to state that just arrived would send it
 * straight back.
 *
 * `now` is the shared clock both screens agree on. Film states are anchored to
 * it, so each screen computes the same moment of the film from the same state.
 */
export function useTogether({
  send,
  now = Date.now,
}: {
  send: (message: PeerMessage) => void;
  now?: () => number;
}) {
  const [albumView, setAlbumView] = useState<AlbumView>(START_VIEW);
  const [albumRevision, setAlbumRevision] = useState(0);
  const [calendarWeek, setCalendarWeek] = useState<string | null>(null);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [film, setFilmState] = useState<FilmState | null>(null);

  // Read by resync and accept, which run from message handlers outside render.
  const latestView = useRef<AlbumView>(START_VIEW);
  const latestWeek = useRef<string | null>(null);
  const latestFilm = useRef<{ film: FilmState | null; key: [number, string] }>({
    film: null,
    key: [Number.NEGATIVE_INFINITY, ""],
  });

  const showAlbum = useCallback(
    (view: AlbumView) => {
      latestView.current = view;
      setAlbumView(view);
      send({ t: "album-view", itemId: view.itemId, gear: view.gear });
    },
    [send],
  );

  const albumChanged = useCallback(() => send({ t: "album-changed" }), [send]);

  const showWeek = useCallback(
    (start: string) => {
      latestWeek.current = start;
      setCalendarWeek(start);
      send({ t: "calendar-week", start });
    },
    [send],
  );

  const calendarChanged = useCallback(() => send({ t: "calendar-changed" }), [send]);

  const setFilm = useCallback(
    (next: FilmState | null) => {
      const sentAt = now();
      latestFilm.current = { film: next, key: filmKey(next, sentAt) };
      setFilmState(next);
      send({ t: "film", film: next, sentAt });
    },
    [now, send],
  );

  const accept = useCallback((message: PeerMessage) => {
    if (message.t === "album-view") {
      const view = { itemId: message.itemId, gear: message.gear };
      latestView.current = view;
      setAlbumView(view);
    } else if (message.t === "album-changed") {
      setAlbumRevision((revision) => revision + 1);
    } else if (message.t === "calendar-week") {
      latestWeek.current = message.start;
      setCalendarWeek(message.start);
    } else if (message.t === "calendar-changed") {
      setCalendarRevision((revision) => revision + 1);
    } else if (message.t === "film") {
      const key = filmKey(message.film, message.sentAt);
      if (!later(key, latestFilm.current.key)) return;
      latestFilm.current = { film: message.film, key };
      setFilmState(message.film);
    }
  }, []);

  /** Tells somebody who has just (re)joined where both views are, and what is playing. */
  const resync = useCallback(() => {
    send({ t: "album-view", itemId: latestView.current.itemId, gear: latestView.current.gear });
    if (latestWeek.current !== null) send({ t: "calendar-week", start: latestWeek.current });
    if (latestFilm.current.film !== null) {
      send({ t: "film", film: latestFilm.current.film, sentAt: latestFilm.current.key[0] });
    }
  }, [send]);

  return {
    albumView,
    albumRevision,
    calendarWeek,
    calendarRevision,
    film,
    showAlbum,
    albumChanged,
    showWeek,
    calendarChanged,
    setFilm,
    accept,
    resync,
  };
}
