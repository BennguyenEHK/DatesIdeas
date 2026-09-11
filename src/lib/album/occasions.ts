import type { TimeZone } from "./types";

function civilParts(instant: string, timeZone: TimeZone): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

/**
 * A reel belongs to the viewer's calendar, so its date must be extracted with
 * the supplied zone instead of inheriting the browser or server's own zone.
 */
export function civilDate(instant: string, timeZone: TimeZone): string {
  const parts = civilParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function civilMonth(instant: string, timeZone: TimeZone): string {
  return civilDate(instant, timeZone).slice(0, 7);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Leap-day anniversaries stay close to their original promise in ordinary
 * years, rather than vanishing for three years out of every four.
 */
export function occurrenceInYear(onDate: string, year: number): string {
  const monthDay = onDate.slice(5);
  return monthDay === "02-29" && !isLeapYear(year)
    ? `${year}-02-28`
    : `${year}-${monthDay}`;
}

export function yearsSpanned(dates: string[]): number[] {
  if (dates.length === 0) return [];

  const years = dates.map((date) => Number(date.slice(0, 4)));
  const oldest = Math.min(...years);
  const newest = Math.max(...years);
  return Array.from({ length: newest - oldest + 1 }, (_, index) => oldest + index);
}
