import type { StoredObject } from "./objects";

/**
 * The daily cleanup: what is safe to delete from the bucket, and nothing else.
 *
 * Everything it touches is passed in, so the rules can be tested without a
 * bucket or a database. The rules are deliberately narrow, because every one of
 * them deletes something a person made:
 *
 *   1. Every photo booth file from a closed room goes. Its QR links stopped
 *      working when the room closed, so nothing can open those files any more.
 *      The room is read from each file's name -- keepsakes/2026/09/
 *      12_21-04-17_strip_KW3KDD_8e2d4a1b.png -- or, for files saved before they
 *      were filed by date, from its folder, keepsakes/KW3KDD/. Files are found
 *      by listing the bucket rather than by reading share records, so files
 *      that never got a record go too.
 *   2. Share records for closed rooms go. They point at files nobody can reach.
 *      A record that points INTO the album loses only the record: an album file
 *      is never deleted because a room closed.
 *   3. An album file that no album entry uses goes -- but only once it is more
 *      than a day old, so an upload still in progress can never be caught.
 *
 * The room itself is never deleted. The home page's "past evenings" reads it.
 */

/** How long an album file with no entry is left alone before it counts as stuck. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface CleanupDeps {
  now: Date;
  listKeys(prefix: string): Promise<StoredObject[]>;
  deleteKeys(keys: readonly string[]): Promise<number>;
  /** Codes of rooms still open right now. Must throw rather than return empty on failure. */
  openRoomCodes(): Promise<Set<string>>;
  deleteClosedKeepsakeRows(): Promise<number>;
  /** Every object and poster key an album entry uses. Must throw on failure. */
  albumKeysInUse(): Promise<Set<string>>;
  albumItemCount(): Promise<number>;
}

/**
 * The room a photo booth file belongs to, or null for anything unrecognised.
 *
 * Null means "leave it alone": a file the cleanup cannot place is never deleted.
 */
export function keepsakeRoom(key: string): string | null {
  const dated = /^keepsakes\/\d{4}\/\d{2}\/\d{2}_[0-9-]+_(?:strip|clip)_([A-Z0-9]+)_[a-f0-9]+\.[a-z0-9]+$/.exec(key);
  if (dated) return dated[1];
  const legacy = /^keepsakes\/([A-Za-z0-9_-]+)\/[^/]+$/.exec(key);
  // A four-digit "room" is a year folder, never a room code.
  return legacy && !/^\d{4}$/.test(legacy[1]) ? legacy[1] : null;
}

export interface CleanupReport {
  closedRooms: string[];
  keepsakeFilesDeleted: number;
  keepsakeRowsDeleted: number;
  albumOrphansDeleted: number;
}

export async function runCleanup(deps: CleanupDeps): Promise<CleanupReport> {
  // ---- 1. closed rooms' photo booth files, whichever month folder they are in
  const keepsakeObjects = await deps.listKeys("keepsakes/");
  const byRoom = new Map<string, string[]>();
  for (const object of keepsakeObjects) {
    const room = keepsakeRoom(object.key);
    if (room === null) continue;
    const keys = byRoom.get(room) ?? [];
    keys.push(object.key);
    byRoom.set(room, keys);
  }

  let closedRooms: string[] = [];
  let keepsakeFilesDeleted = 0;
  if (byRoom.size > 0) {
    const open = await deps.openRoomCodes();
    closedRooms = [...byRoom.keys()].filter((room) => !open.has(room)).sort();
    const doomed = closedRooms.flatMap((room) => byRoom.get(room) ?? []);
    keepsakeFilesDeleted = await deps.deleteKeys(doomed);
  }

  // ---- 2. share records for closed rooms (records only, never album files)
  const keepsakeRowsDeleted = await deps.deleteClosedKeepsakeRows();

  // ---- 3. album files no album entry uses, older than the grace period
  let albumOrphansDeleted = 0;
  const albumObjects = await deps.listKeys("album/");
  if (albumObjects.length > 0) {
    const [inUse, itemCount] = await Promise.all([deps.albumKeysInUse(), deps.albumItemCount()]);

    // Every album entry has its own object key, so the set of keys in use can
    // never be smaller than the number of entries. If it is, the read came back
    // incomplete -- and treating an incomplete read as "these files are unused"
    // would delete real photographs. Refuse instead.
    if (inUse.size < itemCount) {
      throw new Error("the album read looks incomplete; refusing to delete any album files");
    }

    const orphans = albumObjects
      .filter((object) => !inUse.has(object.key))
      .filter(
        (object) =>
          object.lastModified !== null &&
          deps.now.getTime() - object.lastModified.getTime() > ORPHAN_GRACE_MS,
      )
      .map((object) => object.key);
    albumOrphansDeleted = await deps.deleteKeys(orphans);
  }

  return { closedRooms, keepsakeFilesDeleted, keepsakeRowsDeleted, albumOrphansDeleted };
}
