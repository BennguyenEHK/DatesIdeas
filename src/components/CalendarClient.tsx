"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { BlockEditor, type BlockDraft } from "@/components/BlockEditor";
import { CalendarWeek } from "@/components/CalendarWeek";
import { civilDate } from "@/lib/album/occasions";
import type { TimeBlock } from "@/lib/calendar/blocks";
import { expand } from "@/lib/calendar/recur";
import { weekStart } from "@/lib/calendar/week";

type Editor = {
  blockId: string | null;
  initial: { date: string; hour: number } | null;
} | null;

function message(response: Response): Promise<string | null> {
  if (response.ok) {
    return Promise.resolve(null);
  }
  return response
    .json()
    .then((body: unknown) => {
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        return body.error;
      }
      return "The calendar could not be saved.";
    })
    .catch(() => "The calendar could not be saved.");
}

function nextWeek(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export function CalendarClient({
  viewerZone: initialViewerZone,
  week,
  onWeekChange,
  revision,
  onChanged,
  compact = false,
  onUnpaired,
}: {
  viewerZone?: string;
  /** A shared week position. Null leaves this calendar locally controlled. */
  week?: string | null;
  /** Reports a week move made in this browser, never a received week. */
  onWeekChange?: (startIso: string) => void;
  /** Reloads the calendar after the other person has changed it. */
  revision?: number;
  /** Reports a server-accepted create, edit, or delete. */
  onChanged?: () => void;
  /** Packs the controls into the in-call projection. */
  compact?: boolean;
  /** Lets an embedded calendar explain a missing season ticket. */
  onUnpaired?: () => void;
}) {
  const [viewerZone] = useState(
    () => initialViewerZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [localShown, setLocalShown] = useState(() => weekStart(new Date(), viewerZone));
  const [todayDate] = useState(() => civilDate(new Date().toISOString(), viewerZone));
  const [companionZone, setCompanionZone] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [editor, setEditor] = useState<Editor>(null);

  // Memoised on the string, not recomputed each render: a fresh Date every
  // render would change `until`, then `load`, and the load effect would fire on
  // every render -- a request loop for as long as the calendar is open together.
  const shown = useMemo(
    () => (week === undefined || week === null ? localShown : weekStart(new Date(week), viewerZone)),
    [localShown, viewerZone, week],
  );
  const until = useMemo(() => nextWeek(shown, 38).toISOString(), [shown]);
  const occurrences = useMemo(
    () => expand(blocks, shown, nextWeek(shown, 7), viewerZone),
    [blocks, shown, viewerZone],
  );
  const blockMap = useMemo(
    () =>
      new Map(
        blocks.map((block) => [
          block.id,
          { title: block.title, owner: block.owner },
        ]),
      ),
    [blocks],
  );
  const editing =
    editor?.blockId === null
      ? null
      : blocks.find((block) => block.id === editor?.blockId) ?? null;

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch(
        `/api/calendar?until=${encodeURIComponent(until)}`,
        { credentials: "same-origin" },
      );
      if (response.status === 401) {
        onUnpaired?.();
        throw new Error("unpaired");
      }
      if (!response.ok) {
        throw new Error("refused");
      }
      const body = (await response.json()) as { blocks: TimeBlock[] };
      setBlocks(body.blocks);
      setStatus("ready");
    } catch {
      setStatus("failed");
    }
  }, [onUnpaired, until]);

  useEffect(() => {
    const request = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(request);
  }, [load, revision]);

  const moveWeek = useCallback(
    (next: Date) => {
      if (week === undefined || week === null) {
        setLocalShown(next);
      }
      onWeekChange?.(next.toISOString());
    },
    [onWeekChange, week],
  );

  const save = useCallback(
    async (draft: BlockDraft, id: string | null): Promise<string | null> => {
      if (id === null) {
        const temporary: TimeBlock = {
          ...draft,
          id: `new-${crypto.randomUUID()}`,
        };
        setBlocks((previous) => [...previous, temporary]);
        try {
          const response = await fetch("/api/calendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(draft),
          });
          const failure = await message(response);
          if (failure !== null) {
            throw new Error(failure);
          }
          const body = (await response.json()) as { id: string };
          setBlocks((previous) =>
            previous.map((block) =>
              block.id === temporary.id ? { ...temporary, id: body.id } : block,
            ),
          );
          setEditor(null);
          onChanged?.();
          return null;
        } catch (error) {
          setBlocks((previous) =>
            previous.filter((block) => block.id !== temporary.id),
          );
          return error instanceof Error
            ? error.message
            : "The calendar could not be saved.";
        }
      }

      const original = blocks.find((block) => block.id === id);
      if (original === undefined) {
        return "That time no longer exists.";
      }
      const changed: TimeBlock = { ...original, ...draft };
      setBlocks((previous) =>
        previous.map((block) => (block.id === id ? changed : block)),
      );
      try {
        const response = await fetch("/api/calendar", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id, ...draft }),
        });
        const failure = await message(response);
        if (failure !== null) {
          throw new Error(failure);
        }
        setEditor(null);
        onChanged?.();
        return null;
      } catch (error) {
        setBlocks((previous) =>
          previous.map((block) => (block.id === id ? original : block)),
        );
        return error instanceof Error
          ? error.message
          : "The calendar could not be saved.";
      }
    },
    [blocks, onChanged],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      const original = blocks.find((block) => block.id === id);
      if (original === undefined) {
        return "That time no longer exists.";
      }
      setBlocks((previous) => previous.filter((block) => block.id !== id));
      try {
        const response = await fetch(
          `/api/calendar?id=${encodeURIComponent(id)}`,
          { method: "DELETE", credentials: "same-origin" },
        );
        const failure = await message(response);
        if (failure !== null) {
          throw new Error(failure);
        }
        setEditor(null);
        onChanged?.();
        return null;
      } catch (error) {
        setBlocks((previous) => [...previous, original]);
        return error instanceof Error
          ? error.message
          : "The calendar could not be saved.";
      }
    },
    [blocks, onChanged],
  );

  return (
    <div className={`flex min-h-0 flex-col bg-[var(--night)] ${compact ? "h-full" : "h-dvh"}`}>
      <header
        className={`${compact ? "flex" : "bar-top flex"} flex-wrap items-center justify-between gap-2
          bg-[var(--letterbox)] ${compact
            ? "border-b border-[var(--edge)] px-3 py-2"
            : "px-5 py-3"}`}
      >
        {compact ? (
          <p className="font-display text-lg tracking-wide text-[var(--cream)]">Shared table</p>
        ) : (
          <Wordmark size="compact" />
        )}
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs text-[var(--mist)]">
          <span className={compact ? "hidden sm:inline" : undefined}>{viewerZone}</span>
          <label className="sr-only" htmlFor="companion-zone">
            Second timezone
          </label>
          <select
            id="companion-zone"
            value={companionZone ?? ""}
            onChange={(event) =>
              setCompanionZone(
                event.target.value === "" ? null : event.target.value,
              )
            }
            className={`${compact ? "h-7 max-w-36" : "h-8"} border border-[var(--edge)]
              bg-[var(--night)] px-2 text-[var(--cream)]`}
          >
            <option value="">Show their timezone</option>
            {Intl.supportedValuesOf("timeZone").map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              setEditor({
                blockId: null,
                initial: { date: civilDate(shown.toISOString(), viewerZone), hour: 9 },
              })
            }
            className={`${compact ? "h-7 px-2" : "h-8 px-3"} text-[var(--lamp)] ring-1
              ring-[var(--lamp)]/50`}
          >
            Add time
          </button>
        </div>
      </header>
      <main className={`${compact ? "px-2 py-2" : "px-3 py-3"} min-h-0 flex-1`}>
        <div className={`${compact ? "mb-2" : "mb-3"} flex items-center justify-between gap-2`}>
          <button
            type="button"
            onClick={() => moveWeek(nextWeek(shown, -7))}
            className="font-sans text-sm text-[var(--mist)]"
          >
            Previous week
          </button>
          <p className={`${compact ? "text-base" : "text-xl"} font-display text-[var(--cream)]`}>
            Your shared week
          </p>
          <button
            type="button"
            onClick={() => moveWeek(weekStart(new Date(), viewerZone))}
            className="font-sans text-xs text-[var(--lamp)]"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => moveWeek(nextWeek(shown, 7))}
            className="font-sans text-sm text-[var(--mist)]"
          >
            Next week
          </button>
        </div>
        {status === "loading" ? (
          <p className="font-sans text-sm text-[var(--mist)]">
            Opening your week…
          </p>
        ) : null}
        {status === "failed" ? (
          <div className="text-center">
            <p className="font-sans text-sm text-[var(--cream)]">
              The calendar could not open.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 font-sans text-sm text-[var(--lamp)] underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        ) : null}
        {status === "ready" ? (
          <CalendarWeek
            start={shown}
            viewerZone={viewerZone}
            companionZone={companionZone}
            todayDate={todayDate}
            occurrences={occurrences}
            blocks={blockMap}
            onCreate={(date, hour) =>
              setEditor({ blockId: null, initial: { date, hour } })
            }
            onEdit={(blockId) => setEditor({ blockId, initial: null })}
          />
        ) : null}
      </main>
      <footer
        className={`${compact ? "border-t border-[var(--edge)] px-3 py-2" : "bar-bottom px-5 py-3"}
          bg-[var(--letterbox)] font-sans text-xs text-[var(--mist)]`}
      >
        {companionZone === null
          ? "Choose their timezone to keep both clocks in view."
          : `Their clock: ${companionZone}`}
      </footer>
      {editor !== null ? (
        <BlockEditor
          key={editor.blockId ?? `${editor.initial?.date}-${editor.initial?.hour}`}
          block={editing}
          initial={editor.initial}
          viewerZone={viewerZone}
          onSave={save}
          onDelete={remove}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
