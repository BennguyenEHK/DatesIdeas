import { isValidRoomCode } from "@/lib/room/code";

/**
 * The rooms this device has been in.
 *
 * A room code now lasts a day, so the code can no longer be what "your
 * history" means — tomorrow's code has no evenings attached to it. This list
 * is what carries "Past evenings" across a habit of nightly rooms: the browser
 * remembers where it has been, and asks for the sessions from all of them.
 *
 * It lives on the device rather than in the database because there is no
 * account to hang it from, and because it is a convenience: losing it loses a
 * list, not an evening. The rows themselves are never deleted.
 *
 * The functions here are pure so the list rules can be tested without a
 * browser; identity.ts is the only place that touches localStorage.
 */
export const MAX_REMEMBERED_ROOMS = 40;

/** Newest first, no duplicates, capped. Codes that are not codes never enter. */
export function rememberRoom(list: readonly string[], code: string): string[] {
  const next = code.toUpperCase();
  if (!isValidRoomCode(next)) return [...list];
  return [next, ...list.filter((c) => c !== next)].slice(0, MAX_REMEMBERED_ROOMS);
}

/**
 * Parse what was stored, tolerating anything.
 *
 * localStorage is writable by the person using the browser and survives across
 * versions of the app, so this treats its contents as untrusted input: the
 * home page must render whatever it finds there. Entries are re-validated on
 * the way out as well as in, because a list written by an older build has not
 * necessarily been through the same rules.
 */
export function readRoomList(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c): c is string => typeof c === "string" && isValidRoomCode(c))
    .map((c) => c.toUpperCase())
    .slice(0, MAX_REMEMBERED_ROOMS);
}
