import { isLookbookId } from "./types";

const PAIR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

/**
 * Where a piece's photo lives: in the pair's own Lookbook folder, named by
 * the piece id, so the key alone says whose it is and what it belongs to.
 */
export function pieceKey(
  pairId: string,
  pieceId: string,
  contentType: keyof typeof EXTENSIONS,
): string {
  if (!PAIR_ID.test(pairId) || !isLookbookId(pieceId) || !(contentType in EXTENSIONS)) {
    throw new TypeError("invalid lookbook path");
  }
  return `lookbook/${pairId}/${pieceId}.${EXTENSIONS[contentType]}`;
}

/** Whether a key is a well-formed piece photo in exactly this pair's folder. */
export function isLookbookKeyFor(pairId: string, key: unknown): key is string {
  if (!PAIR_ID.test(pairId) || typeof key !== "string" || key.includes("..") || key.includes("\\")) {
    return false;
  }
  const escaped = pairId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^lookbook/${escaped}/[A-Za-z0-9_-]{6,40}\\.(?:jpg|png|webp)$`).test(key);
}
