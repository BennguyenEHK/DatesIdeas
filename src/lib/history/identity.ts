import { isValidRoomCode } from "@/lib/room/code";
import { readRoomList, rememberRoom } from "./rooms";

const IDENTITY_KEY = "datesidea.identity";
const NAME_KEY = "datesidea.name";
const ROOM_KEY = "datesidea.room";
const ROOMS_KEY = "datesidea.rooms";

/**
 * Storage can be unavailable — a private window, a browser set to block site
 * data — and it throws on access rather than returning null. None of what is
 * kept here is worth a blank page, so every read and write is allowed to fail.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing here is worth interrupting an evening for */
  }
}

/**
 * A device-local UUID. This is not an account — it exists only so history
 * rows can tell the two participants apart.
 */
export function getIdentity(): string {
  const existing = read(IDENTITY_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  write(IDENTITY_KEY, id);
  return id;
}

export function getDisplayName(): string | null {
  return read(NAME_KEY);
}

export function setDisplayName(name: string): void {
  write(NAME_KEY, name);
}

/** The room most recently entered, which may since have closed. */
export function getSavedRoom(): string | null {
  return read(ROOM_KEY);
}

/**
 * Every room this device has been in, newest first.
 *
 * Since a code only lasts a day, this list — not the current code — is what
 * "Past evenings" is built from. A device that predates the list still has its
 * single saved room, and that evening is folded in rather than lost.
 */
export function getRoomHistory(): string[] {
  const list = readRoomList(read(ROOMS_KEY));
  if (list.length > 0) return list;
  const only = getSavedRoom();
  return only && isValidRoomCode(only) ? [only.toUpperCase()] : [];
}

export function saveRoom(code: string): void {
  const room = code.toUpperCase();
  write(ROOM_KEY, room);
  write(ROOMS_KEY, JSON.stringify(rememberRoom(getRoomHistory(), room)));
}
