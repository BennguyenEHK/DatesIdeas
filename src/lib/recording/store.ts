"use client";

/**
 * Where a recording waits before you decide what to do with it.
 *
 * IndexedDB, not localStorage. localStorage holds strings and caps out around
 * five megabytes; a minute of recorded call is tens of megabytes of binary. The
 * choice was between this and a `temp/` prefix in the bucket, and this wins for
 * the same reason the photo booth keeps its strip local until you ask to share:
 * a recording of the two of you should not leave the machine that made it until
 * somebody decides it should.
 *
 * Nothing here is durable. The browser may evict it, and clearing site data
 * certainly will. That is honest to what this is -- a holding area between
 * pressing stop and deciding -- and the album is where anything you want to
 * keep actually goes.
 */

const DB_NAME = "festibooth-recordings";
const DB_VERSION = 1;
const STORE = "clips";

export interface StoredRecording {
  id: string;
  /** The room the call happened in, so a page can show only this evening's. */
  room: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  bytes: number;
  /** When the recording was stopped. */
  at: number;
  /** Marked with the heart. Favourites also go to the album. */
  loved: boolean;
}

/** What a listing needs, without dragging every blob into memory to draw it. */
export type RecordingSummary = Omit<StoredRecording, "blob">;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb unavailable"));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // Every read on the recordings page is "this evening's", so the room
        // is the index rather than the timestamp.
        store.createIndex("room", "room", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the store"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("the store refused"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** True when this browser can hold recordings at all. */
export function canStore(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

export async function putRecording(recording: StoredRecording): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.put(recording));
    return true;
  } catch {
    // A private window, a full disk, a browser refusing storage. The clip is
    // still in memory and can still be downloaded; only keeping it fails.
    return false;
  }
}

export async function getRecording(id: string): Promise<StoredRecording | null> {
  try {
    const found = await run<StoredRecording | undefined>("readonly", (store) => store.get(id));
    return found ?? null;
  } catch {
    return null;
  }
}

/**
 * This evening's recordings, newest first, without their blobs.
 *
 * The blobs are fetched one at a time when something is actually played. A
 * listing that loaded six videos into memory to draw six thumbnails would make
 * the page unusable on the phone most likely to be looking at it.
 */
export async function listRecordings(room: string): Promise<RecordingSummary[]> {
  try {
    const all = await run<StoredRecording[]>("readonly", (store) =>
      store.index("room").getAll(room),
    );
    return all
      .map(({ blob, ...summary }) => {
        void blob;
        return summary;
      })
      .sort((left, right) => right.at - left.at);
  } catch {
    return [];
  }
}

export async function deleteRecording(id: string): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.delete(id));
    return true;
  } catch {
    return false;
  }
}

export async function setLoved(id: string, loved: boolean): Promise<boolean> {
  const existing = await getRecording(id);
  if (existing === null) return false;
  return putRecording({ ...existing, loved });
}

/** A short, sortable id. Recordings never leave the device, so this only has
 *  to be unique within one browser. */
export function newRecordingId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}
