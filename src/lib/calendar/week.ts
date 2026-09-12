import type { Occurrence } from "./recur";
import { civilAt, instantFromCivil } from "./recur";

function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T12:00:00.000Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

function midnight(date: string, zone: string): Date | null {
  const instant = instantFromCivil(date, "00:00", zone);
  return instant === null ? null : new Date(instant);
}

function weekdayIndex(instant: Date, zone: string): number {
  const weekday = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    weekday: "short",
  }).format(instant);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

function dayLabel(date: string, zone: string): string {
  const instant = instantFromCivil(date, "12:00", zone);
  if (instant === null) {
    return date;
  }
  const weekday = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    weekday: "short",
  }).format(new Date(instant));
  return `${weekday} ${Number(date.slice(-2))}`;
}

export function weekStart(date: Date, zone: string): Date {
  const civilDate = civilAt(date.toISOString(), zone).date;
  const weekday = weekdayIndex(date, zone);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const instant = instantFromCivil(addDays(civilDate, mondayOffset), "00:00", zone);
  return instant === null ? new Date(Number.NaN) : new Date(instant);
}

export function weekDays(
  start: Date,
  zone: string,
): { date: string; label: string }[] {
  const first = civilAt(start.toISOString(), zone).date;
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(first, index);
    return { date, label: dayLabel(date, zone) };
  });
}

export function placeOccurrence(
  occurrence: Occurrence,
  dayDate: string,
  zone: string,
): { topPct: number; heightPct: number } | null {
  const start = new Date(occurrence.startsAt);
  const end = new Date(occurrence.endsAt);
  const dayStart = midnight(dayDate, zone);
  const dayEnd = midnight(addDays(dayDate, 1), zone);

  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    dayStart === null ||
    dayEnd === null
  ) {
    return null;
  }

  const dayMs = dayEnd.getTime() - dayStart.getTime();
  if (dayMs <= 0) {
    return null;
  }
  if (end.getTime() === start.getTime()) {
    if (start < dayStart || start >= dayEnd) {
      return null;
    }
    const topPct = ((start.getTime() - dayStart.getTime()) / dayMs) * 100;
    return { topPct: Math.max(0, Math.min(100, topPct)), heightPct: 1.2 };
  }
  if (end <= dayStart || start >= dayEnd) {
    return null;
  }

  const clippedStart = Math.max(start.getTime(), dayStart.getTime());
  const clippedEnd = Math.min(end.getTime(), dayEnd.getTime());
  const topPct = ((clippedStart - dayStart.getTime()) / dayMs) * 100;
  const heightPct = ((clippedEnd - clippedStart) / dayMs) * 100;
  return {
    topPct: Math.max(0, Math.min(100, topPct)),
    heightPct: Math.max(1.2, Math.min(100, heightPct)),
  };
}

export function overlapColumns(
  occurrences: Occurrence[],
): Map<string, { index: number; of: number }> {
  const ordered = [...occurrences].sort(
    (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
  );
  const assignments = new Map<string, { index: number; of: number }>();
  let cluster: Occurrence[] = [];
  let clusterEnd = -Infinity;

  const finishCluster = () => {
    const total = Math.max(
      1,
      ...cluster
        .map((item) => assignments.get(item.blockId)?.index ?? 0)
        .map((index) => index + 1),
    );
    cluster.forEach((item) => {
      const found = assignments.get(item.blockId);
      if (found !== undefined) {
        assignments.set(item.blockId, { ...found, of: total });
      }
    });
    cluster = [];
    clusterEnd = -Infinity;
  };

  ordered.forEach((occurrence) => {
    const start = Date.parse(occurrence.startsAt);
    if (cluster.length > 0 && start >= clusterEnd) {
      finishCluster();
    }
    const occupied = new Set(
      cluster
        .filter((item) => Date.parse(item.endsAt) > start)
        .map((item) => assignments.get(item.blockId)?.index),
    );
    let index = 0;
    while (occupied.has(index)) {
      index += 1;
    }
    assignments.set(occurrence.blockId, { index, of: 1 });
    cluster.push(occurrence);
    clusterEnd = Math.max(clusterEnd, Date.parse(occurrence.endsAt));
  });
  if (cluster.length > 0) {
    finishCluster();
  }
  return assignments;
}
