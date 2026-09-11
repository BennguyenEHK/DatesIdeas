"use client";

import { useEffect, useState } from "react";

/**
 * Whether this browser holds a season ticket.
 *
 * Asked once per mount and never cached across mounts, which is deliberate:
 * the answer changes when somebody opens a ticket link in another tab, and a
 * room that had been told "no" at the start of an evening would go on hiding
 * the album for the rest of it.
 *
 * The ticket itself is HttpOnly, so this cannot be answered in the browser --
 * only the server can see the cookie. That is the whole reason this is a fetch
 * rather than a localStorage read.
 */
export function usePair(): { paired: boolean; known: boolean } {
  const [state, setState] = useState<{ paired: boolean; known: boolean }>({
    paired: false,
    known: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pair", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : { paired: false }))
      .then((body: { paired?: unknown }) => {
        if (!cancelled) {
          setState({ paired: body.paired === true, known: true });
        }
      })
      .catch(() => {
        // Not knowing is treated as not paired. The cost is one hidden menu
        // item; the alternative is an option that fails when it is pressed.
        if (!cancelled) setState({ paired: false, known: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
