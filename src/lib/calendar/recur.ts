import { civilDate } from "@/lib/album/occasions";

/**
 * Expanding a repeating block into the occurrences that actually fall in a week.
 *
 * Pure, and deliberately the only place recurrence is computed. It is the part
 * of a calendar that is quietly hard: a weekly block must stay at nine o'clock
 * across a daylight-saving change, a monthly one on the 31st has to do
 * something defensible in February, and "every day until the 30th" must not
 * quietly produce an occurrence on the 31st.
 */

export const REPEATS = ["none", "daily", "weekly", "fortnightly", "monthly"] as const;
export type Repeat = (typeof REPEATS)[number];

export function isRepeat(value: unknown): value is Repeat {
  return typeof value === "string" && (REPEATS as readonly string[]).includes(value);
}

export interface BlockSeed {
  id: string;
  title: string;
  /** ISO instant of the first occurrence. */
  startsAt: string;
  endsAt: string;
  /** IANA zone the block was written in. */
  zone: string;
  repeat: Repeat;
  /** YYYY-MM-DD, inclusive, or null for forever. */
  repeatUntil: string | null;
}

export interface Occurrence {
  blockId: string;
  /** ISO instant. */
  startsAt: string;
  endsAt: string;
  /** The civil day it lands on, in the VIEWER's zone. */
  date: string;
  /** True when this is a later repeat rather than the original. */
  repeated: boolean;
}

/** The parts of an instant, as they read in a given zone. */
interface Civil {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function civilParts(instant: Date, zone: string): Civil {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const read = (type: string): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number(found.value);
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/**
 * The offset of a zone from UTC at a given instant, in minutes.
 *
 * There is no built-in for this. Formatting the instant in the zone and reading
 * the numbers back as if they were UTC gives a value that differs from the real
 * instant by exactly the offset.
 */
function offsetMinutes(instant: Date, zone: string): number {
  const civil = civilParts(instant, zone);
  const asUtc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * The instant at which a given wall-clock time occurs in a zone.
 *
 * Two passes, and the second one is the daylight-saving correction. A first
 * guess using the offset that applied *before* the clocks changed lands an hour
 * out; re-reading the offset at the guessed instant and applying it again
 * lands on the right one. This is what keeps a weekly 09:00 at 09:00 in
 * October rather than silently becoming 08:00.
 */
function instantForCivil(civil: Civil, zone: string): Date {
  const naive = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), zone) * 60_000);
  const corrected = new Date(naive - offsetMinutes(firstGuess, zone) * 60_000);
  return corrected;
}

/** Days in a month, so a monthly repeat on the 31st has somewhere to land. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Moves a civil date on by one step of a repeat.
 *
 * A monthly repeat keeps the day of the month it started on and clamps to the
 * last day of a shorter one — the 31st becomes the 28th in February and then
 * goes back to the 31st in March. Advancing the clamped value instead would
 * drag the whole series earlier for good after a single short month, which is
 * the classic way a monthly recurrence rots.
 */
function step(from: Civil, anchorDay: number, repeat: Repeat): Civil {
  switch (repeat) {
    case "daily":
      return shiftDays(from, 1);
    case "weekly":
      return shiftDays(from, 7);
    case "fortnightly":
      return shiftDays(from, 14);
    case "monthly": {
      const month = from.month === 12 ? 1 : from.month + 1;
      const year = from.month === 12 ? from.year + 1 : from.year;
      return { ...from, year, month, day: Math.min(anchorDay, daysInMonth(year, month)) };
    }
    default:
      return from;
  }
}

function shiftDays(from: Civil, days: number): Civil {
  const moved = new Date(Date.UTC(from.year, from.month - 1, from.day + days));
  return {
    ...from,
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/** A hard stop, so a bad repeat cannot spin forever on a malformed row. */
const MAX_OCCURRENCES = 400;

/**
 * Every occurrence of a block that overlaps [windowStart, windowEnd).
 *
 * `viewerZone` decides only which civil day each occurrence is reported under —
 * the expansion itself happens in the block's own zone, because that is the
 * clock the person who wrote it was reading.
 */
export function occurrencesIn(
  block: BlockSeed,
  windowStart: Date,
  windowEnd: Date,
  viewerZone: string,
): Occurrence[] {
  const start = new Date(block.startsAt);
  const end = new Date(block.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];

  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const found: Occurrence[] = [];

  const emit = (at: Date, repeated: boolean) => {
    const finish = new Date(at.getTime() + durationMs);
    // Overlap, not containment: a block that started yesterday evening and runs
    // past midnight belongs to today's view as well.
    if (finish <= windowStart || at >= windowEnd) return;
    found.push({
      blockId: block.id,
      startsAt: at.toISOString(),
      endsAt: finish.toISOString(),
      date: civilDate(at.toISOString(), viewerZone),
      repeated,
    });
  };

  if (block.repeat === "none") {
    emit(start, false);
    return found;
  }

  const anchor = civilParts(start, block.zone);
  const anchorDay = anchor.day;
  // Inclusive: "until the 30th" includes an occurrence on the 30th.
  const until =
    block.repeatUntil === null
      ? null
      : new Date(`${block.repeatUntil}T23:59:59.999Z`).getTime();

  let civil = anchor;
  let at = start;
  let count = 0;
  let first = true;

  while (count < MAX_OCCURRENCES) {
    if (at.getTime() >= windowEnd.getTime() + durationMs) break;
    if (until !== null && at.getTime() > until) break;
    emit(at, !first);

    civil = step(civil, anchorDay, block.repeat);
    at = instantForCivil(civil, block.zone);
    first = false;
    count += 1;
  }

  return found;
}

/** Expands many blocks at once, sorted by when they start. */
export function expand(
  blocks: readonly BlockSeed[],
  windowStart: Date,
  windowEnd: Date,
  viewerZone: string,
): Occurrence[] {
  return blocks
    .flatMap((block) => occurrencesIn(block, windowStart, windowEnd, viewerZone))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}
