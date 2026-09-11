import { type AlbumKind, isAlbumKind, moves } from "./types";

/**
 * Storage paths for album objects, and the rule for what this app will sign.
 *
 * The same discipline as `src/lib/photo/keepsake.ts`: a key is built here and
 * never accepted from a caller. A presigned PUT is permission to write to
 * exactly one path, so letting a client name that path would turn the signer
 * into write access to the whole bucket.
 */

/** Largest upload allowed, per kind, in megabytes. */
export const MAX_ALBUM_MB: Record<AlbumKind, number> = {
  strip: 25,
  photo: 25,
  clip: 200,
  video: 200,
  recording: 200,
};

/**
 * What each kind is allowed to be stored as.
 *
 * An allowlist rather than a passthrough, for the reason `api/keepsake` gives:
 * the URL is signed for exactly one content type, so an unchecked value lets a
 * caller have this app sign a link serving whatever it likes from our bucket.
 */
export const ALBUM_CONTENT_TYPES: Record<AlbumKind, readonly string[]> = {
  strip: ["image/png"],
  photo: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  clip: ["video/mp4", "video/webm"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  recording: ["video/mp4", "video/webm"],
};

/** The file extension stored for a given content type, without the dot. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** A poster is always JPEG: it is a thumbnail, drawn by us, never the original. */
export const POSTER_CONTENT_TYPE = "image/jpeg";

export function albumExtension(contentType: string): string | null {
  return EXTENSION_BY_TYPE[contentType.toLowerCase()] ?? null;
}

export function allowsContentType(kind: AlbumKind, contentType: string): boolean {
  return ALBUM_CONTENT_TYPES[kind].includes(contentType.toLowerCase());
}

export function withinCap(kind: AlbumKind, bytes: number): boolean {
  if (!Number.isFinite(bytes) || bytes <= 0) return false;
  return bytes <= MAX_ALBUM_MB[kind] * 1024 * 1024;
}

/**
 * A uuid, checked rather than trusted, because it becomes a path segment.
 *
 * The pair id comes from an authenticated lookup rather than from the request
 * body, so this should never fail -- which is exactly why it is asserted. A
 * check that only fires when something upstream is already wrong is the one
 * worth keeping.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]+$/;

export function albumKey(
  pairId: string,
  kind: AlbumKind,
  extension: string,
  token: string,
): string {
  if (!UUID.test(pairId)) throw new TypeError("pair id is not a uuid");
  if (!isAlbumKind(kind)) throw new TypeError(`unknown album kind: ${kind}`);
  if (!TOKEN.test(token) || token.length === 0) {
    throw new TypeError("token contains invalid characters");
  }
  if (!/^[a-z0-9]{2,4}$/.test(extension)) {
    throw new TypeError("extension contains invalid characters");
  }
  return `album/${pairId}/${kind}-${token}.${extension}`;
}

/** The still that stands in for a moving item. Always beside it, always JPEG. */
export function posterKeyFor(objectKey: string): string {
  if (!isAlbumKey(objectKey)) throw new TypeError("not an album key");
  return `${objectKey.replace(/\.[a-z0-9]+$/, "")}-poster.jpg`;
}

/** Whether a poster is expected for this kind at all. */
export { moves as needsPoster };

/**
 * Whether a key is one this app is allowed to sign for.
 *
 * Mirrors `isKeepsakeKey`, including its explicit refusal of `..` and
 * backslashes. The regex alone would reject both; they are named anyway
 * because the next person to widen this pattern needs to see what it is
 * defending against.
 */
export function isAlbumKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if (key.includes("..") || key.includes("\\")) return false;
  return /^album\/[0-9a-f-]{36}\/(?:strip|clip|photo|video|recording)-[A-Za-z0-9_-]+(?:-poster)?\.[a-z0-9]{2,4}$/.test(
    key,
  );
}
