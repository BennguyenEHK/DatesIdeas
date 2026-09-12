"use client";

import type { Occurrence } from "@/lib/calendar/recur";
import { civilAt } from "@/lib/calendar/recur";
import { overlapColumns, placeOccurrence, weekDays } from "@/lib/calendar/week";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function clock(instant: string, zone: string): string {
  return civilAt(instant, zone).time;
}

function hourLabel(hour: number, zone: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    timeZone: zone,
  }).format(new Date(`2026-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`));
}

export function CalendarWeek({
  start,
  viewerZone,
  companionZone,
  todayDate,
  occurrences,
  blocks,
  onCreate,
  onEdit,
}: {
  start: Date;
  viewerZone: string;
  companionZone: string | null;
  todayDate: string;
  occurrences: Occurrence[];
  blocks: ReadonlyMap<string, { title: string; owner: string }>;
  onCreate: (date: string, hour: number) => void;
  onEdit: (blockId: string) => void;
}) {
  const days = weekDays(start, viewerZone);
  return (
    <section
      aria-label="Week calendar"
      className="min-h-0 overflow-auto border border-[var(--edge)] bg-[var(--dusk)]"
    >
      <div className="grid min-w-[760px] grid-cols-[3.4rem_repeat(7,minmax(6.5rem,1fr))]">
        <div
          className="sticky left-0 top-0 z-20 border-b border-r border-[var(--edge)] bg-[var(--letterbox)]"
        />
        {days.map((day) => (
          <div
            key={day.date}
            className={`sticky top-0 z-10 border-b border-r border-[var(--edge)] px-2 py-2 ${
              day.date === todayDate
                ? "bg-[var(--lamp)]/10"
                : "bg-[var(--letterbox)]"
            }`}
          >
            <p className="font-sans text-xs text-[var(--cream)]">{day.label}</p>
            {companionZone !== null ? (
              <p className="mt-1 font-sans text-[10px] text-[var(--mist)]">
                {clock(`${day.date}T12:00:00.000Z`, companionZone)} there
              </p>
            ) : null}
          </div>
        ))}

        <div className="sticky left-0 z-10 border-r border-[var(--edge)] bg-[var(--letterbox)]">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="h-14 border-b border-[var(--edge)] pr-2 pt-1 text-right font-sans text-[10px] text-[var(--mist)]"
            >
              {hourLabel(hour, viewerZone)}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const inDay = occurrences.filter(
            (item) => placeOccurrence(item, day.date, viewerZone) !== null,
          );
          const columns = overlapColumns(inDay);
          return (
            <div
              key={day.date}
              className={`relative h-[84rem] border-r border-[var(--edge)] bg-[var(--night)]/35 ${
                day.date === todayDate ? "bg-[var(--lamp)]/5" : ""
              }`}
              onClick={(event) => {
                if (event.target !== event.currentTarget) {
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const hour = Math.max(
                  0,
                  Math.min(
                    23,
                    Math.floor(
                      ((event.clientY - bounds.top) / bounds.height) * 24,
                    ),
                  ),
                );
                onCreate(day.date, hour);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCreate(day.date, 9);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Add a block on ${day.label}`}
            >
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-14 border-b border-[var(--edge)]"
                  aria-hidden
                />
              ))}
              {inDay.map((item) => {
                const place = placeOccurrence(item, day.date, viewerZone);
                const column = columns.get(item.blockId) ?? { index: 0, of: 1 };
                const block = blocks.get(item.blockId);
                if (place === null || block === undefined) {
                  return null;
                }
                return (
                  <button
                    key={`${item.blockId}-${item.startsAt}-${day.date}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(item.blockId);
                    }}
                    style={{
                      top: `${place.topPct}%`,
                      height: `${place.heightPct}%`,
                      left: `calc(${(column.index / column.of) * 100}% + 3px)`,
                      width: `calc(${100 / column.of}% - 6px)`,
                    }}
                    className="absolute overflow-hidden border border-[var(--lamp)]/55 bg-[var(--lamp)]/15 px-1.5 text-left font-sans text-[11px] text-[var(--cream)] transition-colors hover:bg-[var(--lamp)]/25"
                    aria-label={`Edit ${block.title}, ${clock(item.startsAt, viewerZone)}`}
                  >
                    <span className="block truncate">{block.title}</span>
                    <span className="block truncate text-[10px] text-[var(--mist)]">
                      {clock(item.startsAt, viewerZone)}
                      {companionZone === null
                        ? ""
                        : ` · ${clock(item.startsAt, companionZone)} there`}
                      {block.owner === "both" ? " together" : ` ${block.owner}`}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
