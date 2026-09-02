"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Ambience } from "@/components/Ambience";
import { Wordmark } from "@/components/Wordmark";
import { RoomGate } from "@/components/RoomGate";
import { getRoomHistory, getSavedRoom, saveRoom } from "@/lib/history/identity";
import { listSessions, type SessionRow } from "@/lib/history/useSession";
import { formatDuration } from "@/lib/history/aggregate";
import { fetchRoomStatus } from "@/lib/room/api";
import { useCreateRoom } from "@/lib/room/useCreateRoom";

export default function Home() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const { start, pending, error } = useCreateRoom();

  // localStorage is a synchronous external store, and it does not change while
  // this page is open. Reading it this way keeps the server render (null) and
  // the client render honest without a setState-in-effect round trip.
  const saved = useSyncExternalStore(
    () => () => {},
    () => getSavedRoom(),
    () => null,
  );

  // Every room this device has been in, not just the current one — a code
  // lasts a day, so asking about today's alone would empty the list nightly.
  useEffect(() => {
    void listSessions(getRoomHistory()).then(setSessions);
  }, []);

  // The last room may have closed since. Offering a door that no longer opens
  // is worse than not offering one.
  useEffect(() => {
    if (!saved) return;
    let cancelled = false;
    void fetchRoomStatus(saved).then((info) => {
      if (!cancelled) setSavedOpen(info.status === "open");
    });
    return () => {
      cancelled = true;
    };
  }, [saved]);

  function join(code: string) {
    saveRoom(code);
    router.push(`/room/${code}`);
  }

  return (
    <>
      <Ambience />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-12 px-6 py-16">
        <header className="rise flex flex-col items-center gap-5 text-center">
          <Wordmark size="hero" />
          <span className="h-px w-20 bg-[var(--lamp)]/45" />
          <p className="text-sm leading-relaxed text-[var(--mist)]">
            An evening in two cities.
          </p>
        </header>

        <div className="rise-late flex flex-col gap-5">
          {saved && savedOpen && (
            <button
              onClick={() => join(saved)}
              className="flex items-center justify-between rounded-[2px] border border-[var(--lamp)]/35 px-5 py-3.5 text-left transition-colors hover:border-[var(--lamp)]/70"
            >
              <span className="text-sm text-[var(--cream)]">Back to your room</span>
              <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.4em] text-[var(--lamp)]">
                {saved}
              </span>
            </button>
          )}

          <RoomGate
            onJoin={join}
            onCreate={() => void start()}
            creating={pending}
            error={error}
          />
        </div>

        {sessions.length > 0 && (
          <section className="rise-late flex flex-col gap-4">
            <h2 className="text-[0.65rem] uppercase tracking-[0.3em] text-[var(--mist)]">
              Past evenings
            </h2>
            <ul className="flex flex-col">
              {sessions.map((s) => {
                const total = Object.values(s.memes_sent).reduce((a, b) => a + b, 0);
                const ms = s.ended_at
                  ? new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()
                  : 0;
                return (
                  <li
                    key={s.id}
                    className="flex items-baseline justify-between border-b border-[var(--edge)] py-2.5 text-sm last:border-b-0"
                  >
                    <span className="text-[var(--cream)]">
                      {new Date(s.started_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="text-[var(--mist)]">
                      {formatDuration(ms)}
                      {total > 0 && ` · ${total} reactions`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
