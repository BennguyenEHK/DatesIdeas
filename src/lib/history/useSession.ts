"use client";

import { useCallback, useEffect, useRef } from "react";
import { getIdentity, getDisplayName } from "./identity";
import { MemeCounter } from "./aggregate";
import type { MemeId } from "@/lib/rtc/protocol";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  memes_sent: Record<string, number>;
}

/**
 * Past evenings across every room this device has been in.
 *
 * Takes a list rather than a single code because a code only lasts a day now:
 * asking about the current room alone would empty the log every morning.
 */
export async function listSessions(codes: string[]): Promise<SessionRow[]> {
  if (codes.length === 0) return [];
  try {
    const res = await fetch(
      `/api/sessions?codes=${encodeURIComponent(codes.join(","))}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { sessions: SessionRow[] };
    return body.sessions ?? [];
  } catch {
    return [];
  }
}

/**
 * Opens a session row when the call connects and closes it on unload.
 * Meme counts accumulate locally and flush exactly once, at the end.
 */
export function useSession(code: string, connected: boolean) {
  const counter = useRef(new MemeCounter());
  const sessionId = useRef<string | null>(null);

  const recordMeme = useCallback((id: MemeId) => {
    counter.current.record(id);
  }, []);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            identity: getIdentity(),
            name: getDisplayName(),
          }),
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { id: string };
        sessionId.current = body.id;
      } catch {
        // History is a nicety. Never let it interfere with the call.
      }
    })();

    const close = () => {
      const id = sessionId.current;
      if (!id) return;
      sessionId.current = null;
      const payload = JSON.stringify({ id, memes: counter.current.snapshot() });

      // On unload, fetch is cancelled but sendBeacon survives — and closing
      // the tab is the common way a date night ends, so this is the path that
      // has to work. sendBeacon can only POST, which is why closing has its
      // own endpoint rather than being a PATCH on /api/sessions.
      const beacon = navigator.sendBeacon?.bind(navigator);
      if (beacon) {
        beacon(
          "/api/sessions/close",
          new Blob([payload], { type: "application/json" }),
        );
        return;
      }
      void fetch("/api/sessions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", close);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", close);
      close();
    };
  }, [code, connected]);

  return { recordMeme };
}
