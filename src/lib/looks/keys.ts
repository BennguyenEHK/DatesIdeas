import { isLookId } from "./types";

const PAIR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_TOKEN = /^[A-Za-z0-9_-]{6,40}$/;
const SOURCE_EXTENSION = /^[a-z0-9]{2,5}$/;

function validPairId(pairId: string): boolean {
  return PAIR_ID.test(pairId);
}

/** The opaque, fully painted layer that sits behind the people in the booth. */
export function backdropKey(pairId: string, lookId: string): string {
  if (!validPairId(pairId) || !isLookId(lookId)) throw new TypeError("invalid look path");
  return `looks/${pairId}/${lookId}-backdrop.png`;
}

/** The transparent paint and stickers that sit over the people in the booth. */
export function overlayKey(pairId: string, lookId: string): string {
  if (!validPairId(pairId) || !isLookId(lookId)) throw new TypeError("invalid look path");
  return `looks/${pairId}/${lookId}-overlay.png`;
}

/** A temporary designer picture is still private to the pair that uploaded it. */
export function sourceKey(pairId: string, token: string, extension: string): string {
  if (!validPairId(pairId) || !SOURCE_TOKEN.test(token) || !SOURCE_EXTENSION.test(extension)) {
    throw new TypeError("invalid source path");
  }
  return `looks/${pairId}/src/${token}.${extension}`;
}

/** Whether a key is a well-formed object in exactly this pair's looks folder. */
export function isLookKeyFor(pairId: string, key: unknown): key is string {
  if (!validPairId(pairId) || typeof key !== "string" || key.includes("..") || key.includes("\\"))
    return false;
  const escaped = pairId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^looks/${escaped}/(?:[A-Za-z0-9_-]{6,40}-(?:backdrop|overlay)\\.png|src/[A-Za-z0-9_-]{6,40}\\.[a-z0-9]{2,5})$`,
  ).test(key);
}
