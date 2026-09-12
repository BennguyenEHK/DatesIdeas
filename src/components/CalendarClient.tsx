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
}: {
  viewerZone?: string;
}) {
  const [viewerZone] = useState(
    () => initialViewerZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [shown, setShown] = useState(() => weekStart(new Date(), viewerZone));
  const [todayDate] = useState(() => civilDate(new Date().toISOString(), viewerZone));
  const [companionZone, setCompanionZone] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [editor, setEditor] = useState<Editor>(null);

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
      if (!response.ok) {
        throw new Error("refused");
      }
      const body = (await response.json()) as { blocks: TimeBlock[] };
      setBlocks(body.blocks);
      setStatus("ready");
    } catch {
      setStatus("failed");
    }
  }, [until]);

  useEffect(() => {
    const request = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(request);
  }, [load]);

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
    [blocks],
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
        return null;
      } catch (error) {
        setBlocks((previous) => [...previous, original]);
        return error instanceof Error
          ? error.message
          : "The calendar could not be saved.";
      }
    },
    [blocks],
  );

  return (
    <div className="flex h-dvh flex-col bg-[var(--night)]">
      <header
        className="bar-top flex flex-wrap items-center justify-between gap-3 bg-[var(--letterbox)] px-5 py-3"
      >
        <Wordmark size="compact" />
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs text-[var(--mist)]">
          <span>{viewerZone}</span>
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
            className="h-8 border border-[var(--edge)] bg-[var(--night)] px-2 text-[var(--cream)]"
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
            className="h-8 px-3 text-[var(--lamp)] ring-1 ring-[var(--lamp)]/50"
          >
            Add time
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShown((current) => nextWeek(current, -7))}
            className="font-sans text-sm text-[var(--mist)]"
          >
            Previous week
          </button>
          <p className="font-display text-xl text-[var(--cream)]">
            Your shared week
          </p>
          <button
            type="button"
            onClick={() => setShown((current) => nextWeek(current, 7))}
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
      <footer className="bar-bottom bg-[var(--letterbox)] px-5 py-3 font-sans text-xs text-[var(--mist)]">
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
