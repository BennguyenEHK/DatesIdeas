"use client";

import { useState } from "react";
import { isValidRoomCode } from "@/lib/room/code";

export function RoomGate({
  onJoin,
  onCreate,
  creating,
  error,
}: {
  onJoin: (code: string) => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
}) {
  const [value, setValue] = useState("");
  const valid = isValidRoomCode(value);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* The code is minted by the server, so this waits on a request. The
          button says so rather than looking inert, and refuses a second press
          — two clicks would open two rooms and leave one of them unused. */}
      <button
        onClick={onCreate}
        disabled={creating}
        className="w-full rounded-[2px] bg-[var(--dress)] px-6 py-3.5 text-sm font-medium tracking-wide text-[#1a1405] transition-colors hover:bg-[var(--lamp)] disabled:cursor-not-allowed disabled:bg-[var(--mist)]/30 disabled:text-[var(--mist)]"
      >
        {creating ? "Opening a room…" : "Start the evening"}
      </button>

      {error && (
        <p role="alert" className="-mt-3 text-xs text-[var(--neon)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-[var(--edge)]" />
        <span className="text-[0.65rem] uppercase tracking-[0.3em] text-[var(--mist)]">
          or
        </span>
        <span className="h-px flex-1 bg-[var(--edge)]" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onJoin(value.toUpperCase());
        }}
        className="flex flex-col gap-3"
      >
        <label
          htmlFor="room-code"
          className="text-[0.65rem] uppercase tracking-[0.3em] text-[var(--mist)]"
        >
          Join with a code
        </label>
        <div className="flex gap-2">
          <input
            id="room-code"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-[2px] border border-[var(--edge)] bg-[rgba(8,11,28,0.6)] px-4 py-3 text-center font-[family-name:var(--font-display)] text-lg uppercase tracking-[0.5em] text-[var(--cream)] placeholder:text-[var(--mist)]/35 focus:border-[var(--lamp)]/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!valid}
            className="shrink-0 rounded-[2px] border border-[var(--lamp)]/45 px-6 text-sm text-[var(--lamp)] transition-colors hover:bg-[var(--lamp)]/10 disabled:cursor-not-allowed disabled:border-[var(--edge)] disabled:text-[var(--mist)]/40 disabled:hover:bg-transparent"
          >
            Join
          </button>
        </div>
      </form>
    </div>
  );
}
