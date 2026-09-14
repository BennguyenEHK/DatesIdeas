"use client";

import { useCallback, useRef, useState } from "react";
import type { Gear } from "@/lib/album/types";
import type { PeerMessage } from "@/lib/rtc/protocol";

/** Which photograph, in which view, the album open in the call is showing. */
export interface AlbumView {
  itemId: string | null;
  gear: Gear;
}

export const START_VIEW: AlbumView = { itemId: null, gear: "frames" };

/**
 * The album and the calendar, looked at together in the call.
 *
 * Only positions cross: which photograph, which view, which week. Each browser
 * loads the album and the calendar itself with its own season ticket, so a
 * change -- a photograph added, a time block moved -- crosses as a bare notice
 * and the other side reloads. The revision numbers count those notices; a view
 * reloads whenever its revision goes up.
 *
 * `showAlbum` and `showWeek` are for the person's own actions only. A view that
 * called them in response to state that just arrived would send it straight
 * back.
 */
export function useTogether({ send }: { send: (message: PeerMessage) => void }) {
  const [albumView, setAlbumView] = useState<AlbumView>(START_VIEW);
  const [albumRevision, setAlbumRevision] = useState(0);
  const [calendarWeek, setCalendarWeek] = useState<string | null>(null);
  const [calendarRevision, setCalendarRevision] = useState(0);

  // Read by resync and accept, which run from message handlers outside render.
  const latestView = useRef<AlbumView>(START_VIEW);
  const latestWeek = useRef<string | null>(null);

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
    }
  }, []);

  /** Tells somebody who has just (re)joined where both views are. */
  const resync = useCallback(() => {
    send({ t: "album-view", itemId: latestView.current.itemId, gear: latestView.current.gear });
    if (latestWeek.current !== null) send({ t: "calendar-week", start: latestWeek.current });
  }, [send]);

  return {
    albumView,
    albumRevision,
    calendarWeek,
    calendarRevision,
    showAlbum,
    albumChanged,
    showWeek,
    calendarChanged,
    accept,
    resync,
  };
}
