/**
 * The year/month/day-and-time part of every storage key.
 *
 *   album/2026/09/12_23-30-00_photo_3f9a0c1e.jpg
 *         ^^^^^^^^^^^^^^^^^^^^ this part
 *
 * Written on the clock of the phone that took the picture, so a date-night
 * photograph at 11:30 pm is filed under that evening rather than under the next
 * morning in UTC. The phone sends its offset; the server never guesses one.
 */

/** Real time zones run from UTC-12 to UTC+14. Anything outside is a bad value. */
const MAX_OFFSET_MINUTES = 14 * 60;

/** Years that fit four digits, so every folder sorts the same way. */
const EARLIEST = Date.UTC(1000, 0, 1);
const LATEST = Date.UTC(9999, 11, 31, 23, 59, 59);

/**
 * Minutes east of UTC, as sent by a client, or 0 when it is not a real offset.
 *
 * 0 rather than a refusal: a wrong offset only puts a photograph in a folder a
 * few hours off, whereas refusing it would lose the upload.
 */
export function utcOffsetMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 0;
  if (Math.abs(value) > MAX_OFFSET_MINUTES) return 0;
  return value;
}

/**
 * This device's offset at a given instant, minutes east of UTC.
 *
 * Taken at the instant itself, not today: a photograph from July is filed on
 * summer time even when it is uploaded in December.
 */
export function localOffsetMinutes(at: Date | string | number = Date.now()): number {
  const offset = -new Date(at).getTimezoneOffset();
  return Number.isFinite(offset) ? offset + 0 : 0;
}

const two = (value: number) => String(value).padStart(2, "0");

/**
 * `{ folder: "2026/09", stamp: "12_23-30-00" }` for an instant on a given clock.
 *
 * Throws for an instant that is not a date at all; callers pass values they
 * have already clamped.
 */
export function datedParts(
  instant: Date | string,
  offsetMinutes: number,
): { folder: string; stamp: string } {
  const time = new Date(instant).getTime();
  if (!Number.isFinite(time)) throw new TypeError("not a date");
  const clamped = Math.min(Math.max(time, EARLIEST), LATEST);
  const local = new Date(clamped + utcOffsetMinutes(offsetMinutes) * 60_000);
  return {
    folder: `${local.getUTCFullYear()}/${two(local.getUTCMonth() + 1)}`,
    stamp:
      `${two(local.getUTCDate())}_` +
      `${two(local.getUTCHours())}-${two(local.getUTCMinutes())}-${two(local.getUTCSeconds())}`,
  };
}

/** Matches `2026/09/12_23-30-00`, for the key checks. No anchors, no flags. */
export const DATED_PATTERN =
  String.raw`\d{4}\/(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])_(?:[01]\d|2[0-3])-[0-5]\d-[0-5]\d`;
