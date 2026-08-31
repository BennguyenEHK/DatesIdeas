"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Ambience } from "@/components/Ambience";
import { Monogram } from "@/components/Monogram";
import { RoomGate } from "@/components/RoomGate";
import { newRoomCode } from "@/lib/room/code";
import { getSavedRoom, saveRoom } from "@/lib/history/identity";
import { listSessions, type SessionRow } from "@/lib/history/useSession";
import { formatDuration } from "@/lib/history/aggregate";

export default function Home() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  // localStorage is a synchronous external store, and it does not change while
  // this page is open. Reading it this way keeps the server render (null) and
  // the client render honest without a setState-in-effect round trip.
  const saved = useSyncExternalStore(
    () => () => {},
    () => getSavedRoom(),
    () => null,
  );

  useEffect(() => {
    if (saved) void listSessions(saved).then(setSessions);
  }, [saved]);

  function go(code: string) {
    saveRoom(code);
    router.push(`/room/${code}`);
  }

  return (
    <>
      <Ambience />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-12 px-6 py-16">
        <header className="rise flex flex-col items-center gap-5 text-center">
          <Monogram size="hero" />
          <span className="h-px w-20 bg-[var(--lamp)]/45" />
          <p className="text-sm leading-relaxed text-[var(--mist)]">
            An evening in two cities.
          </p>
        </header>

        <div className="rise-late flex flex-col gap-5">
          {saved && (
            <button
              onClick={() => go(saved)}
              className="flex items-center justify-between rounded-[2px] border border-[var(--lamp)]/35 px-5 py-3.5 text-left transition-colors hover:border-[var(--lamp)]/70"
            >
              <span className="text-sm text-[var(--cream)]">Back to your room</span>
              <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.4em] text-[var(--lamp)]">
                {saved}
              </span>
            </button>
          )}

          <RoomGate onJoin={go} onCreate={() => go(newRoomCode())} />
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
