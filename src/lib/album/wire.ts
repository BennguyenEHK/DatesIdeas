import type { AlbumItem, AlbumKind, Occasion } from "./types";

/**
 * The contract between the album's routes and everything that calls them.
 *
 * Written down in one importable place because there are three callers and
 * they cannot be changed together: this browser, a phone that has the app
 * installed, and an Android app that will be built later in another language.
 * A wire shape that lives only in a route handler is a wire shape that drifts.
 */

/** POST /api/album — step one of two. Asks permission to upload. */
export interface PresignRequest {
  kind: AlbumKind;
  contentType: string;
  sizeBytes: number;
  /**
   * When the memory happened, ISO 8601. The client sends the file's own
   * lastModified; the server clamps it (see PresignResponse) rather than
   * trusting it, because a wrong clock here silently misfiles a photograph.
   */
  happenedAt: string;
  /** True when the item moves and a poster will follow. */
  withPoster?: boolean;
  /** The evening that produced it, when one did. */
  sourceRoom?: string | null;
  /**
   * The uploading device's clock at `happenedAt`, in minutes east of UTC.
   * Decides the year/month folder and the day-and-time name. Missing or not a
   * real offset means UTC.
   */
  utcOffsetMinutes?: number;
}

export interface PresignResponse {
  /** The id the item WILL have. The client sends it back to confirm. */
  id: string;
  uploadUrl: string;
  /** Present only when `withPoster` was asked for. */
  posterUploadUrl?: string;
  /** What the server actually recorded, after clamping. */
  happenedAt: string;
  /**
   * The key the server chose, handed back so `confirm` knows what to record.
   *
   * This travels to the client and returns, which looks like an invitation to
   * tamper and is not one: `confirm` re-checks it with `isAlbumKey` and, more
   * to the point, checks `receipt` against the authenticated pair. A client can
   * therefore only ever name a path it was already given for its own album.
   * The alternative -- a server-side table of pending uploads -- would be a
   * second source of truth that needs sweeping when an upload is abandoned,
   * which is most of them.
   */
  objectKey: string;
  /** Proof the server issued `objectKey` to this pair. Send it back unchanged. */
  receipt: string;
  kind: AlbumKind;
}

/**
 * PUT /api/album — step two. The browser says the bytes are really there.
 *
 * The row is written HERE, not at presign, and that is the correction this
 * design makes to `api/keepsake/route.ts`. Inserting first means a failed
 * upload leaves a row pointing at a file that does not exist -- the outcome
 * `0005_keepsakes.sql` itself calls worse than no row at all. Inserting last
 * means a failed upload leaves an orphaned object, which is invisible and
 * costs fractions of a cent.
 */
export interface ConfirmRequest {
  id: string;
  /** Exactly as `presign` returned it. Re-validated against the caller's pair. */
  objectKey: string;
  /** Exactly as `presign` returned it. */
  receipt: string;
  kind: AlbumKind;
  contentType: string;
  sizeBytes: number;
  happenedAt: string;
  sourceRoom?: string | null;
  /** Whether the poster upload also succeeded. */
  posterUploaded?: boolean;
}

export interface ConfirmResponse {
  item: AlbumItem;
}

/** GET /api/album */
export interface ListResponse {
  items: AlbumItem[];
  occasions: Occasion[];
  /**
   * Feed back as `?since=` to ask only for what has arrived since. Runs on
   * created_at, never happened_at -- see the migration for why.
   */
  cursor: string | null;
}

/** PATCH /api/album/[id] — every field optional, only what changed. */
export interface UpdateRequest {
  loved?: boolean;
  caption?: string | null;
  happenedAt?: string;
}

/** What every route says when it goes wrong. */
export interface ErrorResponse {
  error: string;
}

/**
 * How far ahead of now a client's clock is allowed to be.
 *
 * `happenedAt` is client-supplied and backdating is its purpose, so the past
 * is wide open. The future is not: a phone with a wrong clock would otherwise
 * pin a photograph to 2041 and park it permanently at the head of the reel,
 * where nothing later can ever displace it. A day of slack absorbs an honest
 * timezone or clock-skew mistake; beyond that the server uses its own now.
 */
export const HAPPENED_AT_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/** Clamps a client-supplied instant to something the timeline can hold. */
export function clampHappenedAt(value: unknown, now = Date.now()): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return new Date(now).toISOString();
  if (parsed > now + HAPPENED_AT_FUTURE_SLACK_MS) return new Date(now).toISOString();
  // No lower bound. A scanned photograph from before either of you was born is
  // a legitimate thing to put in an album.
  return new Date(parsed).toISOString();
}
