import { isValidRoomCode } from "@/lib/room/code";

/**
 * Where a karaoke song lives in the bucket: `karaoke/<ROOM>/<32 hex>.mp4`.
 *
 * The room is in the path so the daily cleanup can tell, from the name alone,
 * whether the evening that produced a song is over. The token is 128 random
 * bits, so a key cannot be guessed from one the other person was given.
 */
const KARAOKE_KEY = /^karaoke\/([A-Z0-9]{6})\/[0-9a-f]{32}\.mp4$/;

/** A fresh key for one song in one room. Throws on a room code that is not one. */
export function karaokeKey(room: string): string {
  if (typeof room !== "string" || !isValidRoomCode(room)) {
    throw new TypeError("karaokeKey needs a valid room code");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `karaoke/${room.toUpperCase()}/${token}.mp4`;
}

/**
 * Whether a key has exactly the shape this app mints. Anything else is
 * refused, because the same check gates which bucket objects may be deleted.
 */
export function isKaraokeKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  // Redundant with the pattern, but explicit: these two are what a path
  // traversal needs, and the guard should read as one at a glance.
  if (key.includes("..") || key.includes("\\")) return false;
  return KARAOKE_KEY.test(key);
}

/** The room a karaoke key belongs to, or null for any key this app did not mint. */
export function karaokeRoom(key: string): string | null {
  if (!isKaraokeKey(key)) return null;
  return KARAOKE_KEY.exec(key)?.[1] ?? null;
}
