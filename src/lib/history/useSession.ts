"use client";

import { useCallback, useEffect, useRef } from "react";
import { getSupabase } from "@/lib/signaling/supabaseClient";
import { getIdentity, getDisplayName } from "./identity";
import { MemeCounter } from "./aggregate";
import type { MemeId } from "@/lib/rtc/protocol";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  memes_sent: Record<string, number>;
}

export async function listSessions(code: string): Promise<SessionRow[]> {
  const { data, error } = await getSupabase()
    .from("sessions")
    .select("id, started_at, ended_at, memes_sent")
    .eq("couple_code", code)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as SessionRow[];
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
    const sb = getSupabase();
    let cancelled = false;

    void (async () => {
      await sb.from("couples").upsert({ code }, { onConflict: "code" });
      const { data } = await sb
        .from("sessions")
        .insert({ couple_code: code })
        .select("id")
        .single();
      if (cancelled || !data) return;
      sessionId.current = data.id as string;
      await sb.from("participants").upsert({
        session_id: data.id,
        identity: getIdentity(),
        name: getDisplayName(),
      });
    })();

    const close = () => {
      const id = sessionId.current;
      if (!id) return;
      sessionId.current = null;
      void sb
        .from("sessions")
        .update({
          ended_at: new Date().toISOString(),
          memes_sent: counter.current.snapshot(),
        })
        .eq("id", id);
    };

    window.addEventListener("beforeunload", close);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", close);
      close();
    };
  }, [code, connected]);

  // sessionId stays internal: it is a ref, and reading it during render
  // would hand callers a stale value.
  return { recordMeme };
}
