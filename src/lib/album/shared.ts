"use client";

/**
 * Collecting what the Android share sheet handed to the service worker.
 *
 * The worker cannot upload: that needs the season ticket cookie, a presign
 * round trip, and somewhere to show progress or report a failure. So it parks
 * the files in the Cache API and redirects here, and this reads them back.
 *
 * Mirrors `public/sw.js` -- the cache name and key prefix are a contract
 * between the two files, and changing one without the other loses a share
 * silently.
 */

const SHARE_CACHE = "festibooth-shared-v1";
const SHARE_PREFIX = "/__shared__/";

export interface SharedFile {
  blob: Blob;
  name: string;
  type: string;
  /** The phone's own timestamp: when the photograph was taken. */
  lastModified: number;
}

interface IndexEntry {
  key: string;
  name: string;
  type: string;
  lastModified: number;
}

function isEntry(value: unknown): value is IndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    entry.key.startsWith(SHARE_PREFIX) &&
    typeof entry.name === "string" &&
    typeof entry.type === "string" &&
    typeof entry.lastModified === "number"
  );
}

/**
 * Everything waiting from a share, oldest first. Empty when there is nothing,
 * which is the normal case on an ordinary visit to the album.
 */
export async function takeSharedFiles(): Promise<SharedFile[]> {
  if (typeof caches === "undefined") return [];

  try {
    const cache = await caches.open(SHARE_CACHE);
    const indexResponse = await cache.match(new Request(`${SHARE_PREFIX}index`));
    if (indexResponse === undefined) return [];

    const parsed: unknown = await indexResponse.json();
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(isEntry);

    const files: SharedFile[] = [];
    for (const entry of entries) {
      const stored = await cache.match(new Request(entry.key));
      if (stored === undefined) continue;
      files.push({
        blob: await stored.blob(),
        name: entry.name,
        type: entry.type,
        lastModified: entry.lastModified,
      });
    }
    return files;
  } catch {
    // A share that cannot be read is a share that has to be redone by hand.
    // It must never stop the album from opening.
    return [];
  }
}

/**
 * Drops what was shared, once it is safely in the album.
 *
 * Called only after every upload has succeeded. Clearing on arrival would be
 * simpler and would throw away the photograph whenever the upload failed --
 * the one moment the copy in the cache is the only copy that is going to be
 * used, because the person has already left the Photos app behind.
 */
export async function clearSharedFiles(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(SHARE_CACHE);
  } catch {
    // Leaving them costs a little storage and one duplicate offer later.
  }
}
