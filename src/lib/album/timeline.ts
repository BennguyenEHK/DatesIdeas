import { civilDate, civilMonth, occurrenceInYear, yearsSpanned } from "./occasions";
import type {
  AlbumItem,
  Frame,
  Gear,
  LeaderTape,
  Occasion,
  OccasionMark,
  ReelView,
  TimeZone,
} from "./types";

function sortedItems(items: AlbumItem[]): AlbumItem[] {
  return [...items].sort((left, right) => {
    const timeOrder = new Date(right.happenedAt).getTime() - new Date(left.happenedAt).getTime();
    return timeOrder !== 0 ? timeOrder : left.id.localeCompare(right.id);
  });
}

function makeFrame(key: string, date: string, items: AlbumItem[]): Frame {
  return {
    key,
    item: items[0],
    items,
    count: items.length,
    loved: items.some((item) => item.loved),
    date,
  };
}

function buildFrames(items: AlbumItem[], gear: Gear, timeZone: TimeZone): Frame[] {
  const ordered = sortedItems(items);
  if (gear === "frames") {
    return ordered.map((item) => makeFrame(`frame:${item.id}`, civilDate(item.happenedAt, timeZone), [item]));
  }

  const groups = new Map<string, AlbumItem[]>();
  for (const item of ordered) {
    const date = gear === "days" ? civilDate(item.happenedAt, timeZone) : civilMonth(item.happenedAt, timeZone);
    const group = groups.get(date);
    if (group) group.push(item);
    else groups.set(date, [item]);
  }

  return [...groups].map(([groupDate, groupItems]) => {
    const date = gear === "months" ? `${groupDate}-01` : groupDate;
    return makeFrame(`${gear}:${groupDate}`, date, groupItems);
  });
}

function monthLabel(date: string): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function buildTapes(frames: Frame[], gear: Gear): LeaderTape[] {
  const tapes: LeaderTape[] = [];
  let previousBoundary: string | undefined;

  for (const [index, frame] of frames.entries()) {
    const month = frame.date.slice(0, 7);
    const boundary = gear === "months" ? month.slice(0, 4) : month;
    if (boundary === previousBoundary) continue;

    tapes.push({
      beforeIndex: index,
      label: gear === "months" ? boundary : monthLabel(frame.date),
      month,
    });
    previousBoundary = boundary;
  }

  return tapes;
}

function buildMarks(frames: Frame[], occasions: Occasion[], gear: Gear): OccasionMark[] {
  const frameDates = new Map<string, number>();
  for (const [index, frame] of frames.entries()) {
    frameDates.set(gear === "months" ? frame.date.slice(0, 7) : frame.date, index);
  }

  const reelDates = frames.map((frame) => frame.date);
  const marks: OccasionMark[] = occasions.flatMap((occasion) => {
    const dates = occasion.yearly
      ? yearsSpanned(reelDates).map((year) => occurrenceInYear(occasion.onDate, year))
      : [occasion.onDate];

    return dates.map((date): OccasionMark => {
      const frameIndex = frameDates.get(gear === "months" ? date.slice(0, 7) : date) ?? -1;
      return { occasion, date, frameIndex, lit: frameIndex !== -1 };
    });
  });

  return marks.sort((left, right) => right.date.localeCompare(left.date));
}

export function buildReel(
  items: AlbumItem[],
  occasions: Occasion[],
  gear: Gear,
  timeZone: TimeZone,
): ReelView {
  const frames = buildFrames(items, gear, timeZone);
  return { frames, tapes: buildTapes(frames, gear), marks: buildMarks(frames, occasions, gear) };
}

export function frameIndexFor(view: ReelView, itemId: string): number {
  return view.frames.findIndex((frame) => frame.items.some((item) => item.id === itemId));
}
