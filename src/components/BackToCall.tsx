"use client";

import { useState } from "react";

/**
 * The way out of a page that was opened from inside a call.
 *
 * Getting back is harder than it looks, because the obvious answer is wrong. A
 * plain link to the room would open a SECOND copy of it in this tab while the
 * first is still running in the other one -- joining the call twice. So when
 * this page was opened from the room, going back means returning to that tab and
 * closing this one. Only when there is no such tab (the page was opened some
 * other way, or the room's tab has since been closed) does it open the room.
 */
export function BackToCall({ room }: { room: string }) {
  const [stranded, setStranded] = useState(false);

  function back(event: React.MouseEvent<HTMLAnchorElement>) {
    const opener = window.opener as Window | null;
    if (opener === null || opener.closed) return; // no room tab: follow the link

    event.preventDefault();
    try {
      opener.focus();
    } catch {
      // Some browsers will not let one tab bring another forward. Closing this
      // one still leaves the call in front.
    }
    window.close();

    // A tab the browser does not consider script-opened refuses to close, and
    // there is no event for that. If it is still here a moment later, say where
    // the call is rather than leave the button looking broken.
    setTimeout(() => {
      if (!window.closed) setStranded(true);
    }, 200);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={`/room/${encodeURIComponent(room)}`}
        onClick={back}
        className="inline-flex h-8 items-center rounded-full px-3 font-sans text-xs tracking-wide text-[var(--cream)] ring-1 ring-[var(--edge)] transition-colors hover:ring-[var(--lamp)]/60"
      >
        Back to the call
      </a>
      {stranded ? (
        <p role="status" className="font-sans text-xs text-[var(--mist)]">
          Your call is still running in its own tab. You can close this one.
        </p>
      ) : null}
    </div>
  );
}
