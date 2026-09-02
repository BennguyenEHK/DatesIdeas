/**
 * How long a room code stays usable.
 *
 * A code is an unauthenticated key: anyone holding it can walk into the call,
 * and there is no way to revoke one. Giving it a day is what turns that from a
 * permanent liability into a bounded one — it is a lock that changes, not
 * storage housekeeping. Room rows themselves are kept forever; they cost
 * roughly forty bytes and they are what past evenings hang from.
 *
 * These helpers are pure and shared by both sides, so the page and the
 * signalling gate cannot disagree about whether a room is still open.
 */
export const ROOM_TTL_HOURS = 24;
export const ROOM_TTL_MS = ROOM_TTL_HOURS * 60 * 60 * 1000;

/** What the server can say about a code. */
export type RoomStatus = "open" | "expired" | "missing";

function asTime(expiresAt: string | Date | null | undefined): number | null {
  if (expiresAt === null || expiresAt === undefined) return null;
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether the room is still joinable.
 *
 * Strictly greater than, matching the `expires_at > now()` in the signalling
 * insert. If these two disagreed at the boundary the page would invite you
 * into a room the server has already closed.
 */
export function isOpen(
  expiresAt: string | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  const ms = asTime(expiresAt);
  return ms !== null && ms > now;
}

/** Milliseconds left, floored at zero so nothing downstream counts backwards. */
export function remainingMs(
  expiresAt: string | Date | null | undefined,
  now: number = Date.now(),
): number {
  const ms = asTime(expiresAt);
  if (ms === null) return 0;
  return Math.max(0, ms - now);
}

/** The countdown as a person would say it: "23h", "12m", "under a minute". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "closed";
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  // Zero minutes left is not zero time left, and "0m" reads as already over.
  if (minutes >= 1) return `${minutes}m`;
  return "under a minute";
}
