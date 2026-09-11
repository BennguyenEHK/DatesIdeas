import "server-only";

import { isAlbumKind, type AlbumKind, type Occasion } from "./types";
import type { SqlTag } from "../keepsakes/store";

// Neon exposes a wider result union than this module needs. Keeping this
// overload makes the data layer easy to fake without narrowing real callers.
type QueryTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => unknown;

export interface AlbumItemRow {
  id: string;
  pairId: string;
  objectKey: string;
  posterKey: string | null;
  kind: AlbumKind;
  contentType: string;
  bytes: number;
  happenedAt: string;
  createdAt: string;
  caption: string | null;
  loved: boolean;
  sourceRoom: string | null;
  /**
   * The paging cursor for this row, and deliberately NOT the same value as
   * `createdAt`.
   *
   * Postgres keeps timestamptz to the microsecond; a JavaScript Date, and so
   * every ISO string derived from one, stops at the millisecond. Feeding
   * `createdAt` back as `since` therefore asks for rows after 13:06:51.404,
   * and the row stored at 13:06:51.404567 answers yes -- forever. A poller
   * would re-fetch the same photograph on every single pass and believe each
   * time that something new had arrived.
   *
   * So this carries the full microsecond precision, formatted by Postgres and
   * compared by Postgres, and it is treated as opaque everywhere else.
   * `createdAt` remains what you show a person; this is what you page with.
   */
  cursor: string;
}

export interface NewOccasion {
  id: string;
  title: string;
  /** YYYY-MM-DD. A civil date, never an instant. */
  onDate: string;
  yearly: boolean;
}

export interface OccasionPatch {
  title?: string;
  onDate?: string;
  yearly?: boolean;
}

export interface InsertItem {
  id: string;
  pairId: string;
  objectKey: string;
  posterKey: string | null;
  kind: AlbumKind;
  contentType: string;
  bytes: number;
  happenedAt: string;
  sourceRoom: string | null;
}

function instant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function bytes(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readItem(value: unknown): AlbumItemRow | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const happenedAt = instant(row.happened_at);
  const createdAt = instant(row.created_at);
  const size = bytes(row.bytes);
  if (
    typeof row.id !== "string" || typeof row.pair_id !== "string" ||
    typeof row.object_key !== "string" ||
    !(typeof row.poster_key === "string" || row.poster_key === null) ||
    !isAlbumKind(row.kind) || typeof row.content_type !== "string" || size === null ||
    happenedAt === null || createdAt === null ||
    !(typeof row.caption === "string" || row.caption === null) ||
    typeof row.loved !== "boolean" ||
    !(typeof row.source_room === "string" || row.source_room === null)
  ) return null;
  return { id: row.id, pairId: row.pair_id, objectKey: row.object_key, posterKey: row.poster_key,
    kind: row.kind, contentType: row.content_type, bytes: size, happenedAt, createdAt,
    caption: row.caption, loved: row.loved, sourceRoom: row.source_room,
    // Absent on the paths that do not select it (insert echo, delete). Those
    // callers never page, so an absent cursor is correct rather than missing.
    cursor: typeof row.cursor === "string" ? row.cursor : createdAt };
}

function readOccasion(value: unknown): Occasion | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const rawDate = row.on_date instanceof Date ? row.on_date.toISOString().slice(0, 10) : row.on_date;
  if (typeof row.id !== "string" || typeof row.title !== "string" ||
    typeof rawDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ||
    typeof row.yearly !== "boolean" || !(typeof row.cover_item === "string" || row.cover_item === null)) return null;
  return { id: row.id, title: row.title, onDate: rawDate, yearly: row.yearly, coverItemId: row.cover_item };
}

export function insertItem(sql: SqlTag, item: InsertItem): Promise<boolean>;
export function insertItem(sql: QueryTag, item: InsertItem): Promise<boolean>;
export async function insertItem(sql: QueryTag, item: InsertItem): Promise<boolean> {
  const rows = await sql`
    INSERT INTO album_items
      (id, pair_id, object_key, poster_key, kind, content_type, bytes, happened_at, source_room)
    VALUES (${item.id}, ${item.pairId}, ${item.objectKey}, ${item.posterKey}, ${item.kind},
      ${item.contentType}, ${item.bytes}, ${item.happenedAt}, ${item.sourceRoom})
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export function listItems(sql: SqlTag, pairId: string, since?: string | null): Promise<AlbumItemRow[]>;
export function listItems(sql: QueryTag, pairId: string, since?: string | null): Promise<AlbumItemRow[]>;
export async function listItems(sql: QueryTag, pairId: string, since?: string | null): Promise<AlbumItemRow[]> {
  const rows = since === null || since === undefined ? await sql`
    SELECT id, pair_id, object_key, poster_key, kind, content_type, bytes, happened_at,
           caption, loved, source_room, created_at,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor
    FROM album_items WHERE pair_id = ${pairId}
    ORDER BY happened_at DESC LIMIT 500
  ` : await sql`
    SELECT id, pair_id, object_key, poster_key, kind, content_type, bytes, happened_at,
           caption, loved, source_room, created_at,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor
    FROM album_items
    WHERE pair_id = ${pairId} AND created_at > ${since}::timestamptz
    ORDER BY happened_at DESC LIMIT 500
  `;
  return Array.isArray(rows) ? rows.map(readItem).filter((item): item is AlbumItemRow => item !== null) : [];
}

export function listOccasions(sql: SqlTag, pairId: string): Promise<Occasion[]>;
export function listOccasions(sql: QueryTag, pairId: string): Promise<Occasion[]>;
export async function listOccasions(sql: QueryTag, pairId: string): Promise<Occasion[]> {
  const rows = await sql`
    SELECT id, title, on_date, yearly, cover_item FROM occasions
    WHERE pair_id = ${pairId} ORDER BY on_date ASC
  `;
  return Array.isArray(rows) ? rows.map(readOccasion).filter((item): item is Occasion => item !== null) : [];
}

/**
 * Names a day.
 *
 * An occasion is a title pinned to a date and nothing else -- membership is
 * happened_at::date = on_date, computed at read time. That is what lets you
 * name a day months later and have it gather the photographs already sitting
 * there, and it is why there is no "add item to occasion" anywhere.
 */
export function createOccasion(sql: SqlTag, pairId: string, occasion: NewOccasion): Promise<boolean>;
export function createOccasion(sql: QueryTag, pairId: string, occasion: NewOccasion): Promise<boolean>;
export async function createOccasion(sql: QueryTag, pairId: string, occasion: NewOccasion): Promise<boolean> {
  const rows = await sql`
    INSERT INTO occasions (id, pair_id, title, on_date, yearly)
    VALUES (${occasion.id}, ${pairId}, ${occasion.title}, ${occasion.onDate}::date, ${occasion.yearly})
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export function updateOccasion(sql: SqlTag, pairId: string, id: string, patch: OccasionPatch): Promise<boolean>;
export function updateOccasion(sql: QueryTag, pairId: string, id: string, patch: OccasionPatch): Promise<boolean>;
export async function updateOccasion(sql: QueryTag, pairId: string, id: string, patch: OccasionPatch): Promise<boolean> {
  const hasTitle = Object.hasOwn(patch, "title");
  const hasDate = Object.hasOwn(patch, "onDate");
  const hasYearly = Object.hasOwn(patch, "yearly");
  const rows = await sql`
    UPDATE occasions SET
      title = CASE WHEN ${hasTitle} THEN ${patch.title ?? null} ELSE title END,
      on_date = CASE WHEN ${hasDate} THEN ${patch.onDate ?? null}::date ELSE on_date END,
      yearly = CASE WHEN ${hasYearly} THEN ${patch.yearly ?? false} ELSE yearly END
    WHERE pair_id = ${pairId} AND id = ${id}
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

/** Forgets the name. The photographs taken that day are untouched. */
export function deleteOccasion(sql: SqlTag, pairId: string, id: string): Promise<boolean>;
export function deleteOccasion(sql: QueryTag, pairId: string, id: string): Promise<boolean>;
export async function deleteOccasion(sql: QueryTag, pairId: string, id: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM occasions WHERE pair_id = ${pairId} AND id = ${id} RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export function updateItem(sql: SqlTag, pairId: string, id: string, patch: { loved?: boolean; caption?: string | null; happenedAt?: string }): Promise<boolean>;
export function updateItem(sql: QueryTag, pairId: string, id: string, patch: { loved?: boolean; caption?: string | null; happenedAt?: string }): Promise<boolean>;
export async function updateItem(sql: QueryTag, pairId: string, id: string, patch: { loved?: boolean; caption?: string | null; happenedAt?: string }): Promise<boolean> {
  const hasLoved = Object.hasOwn(patch, "loved");
  const hasCaption = Object.hasOwn(patch, "caption");
  const hasHappenedAt = Object.hasOwn(patch, "happenedAt");
  const rows = await sql`
    UPDATE album_items SET
      loved = CASE WHEN ${hasLoved} THEN ${patch.loved ?? false} ELSE loved END,
      caption = CASE WHEN ${hasCaption} THEN ${patch.caption ?? null} ELSE caption END,
      happened_at = CASE WHEN ${hasHappenedAt} THEN ${patch.happenedAt ?? null} ELSE happened_at END
    WHERE pair_id = ${pairId} AND id = ${id}
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export function deleteItem(sql: SqlTag, pairId: string, id: string): Promise<{ objectKey: string; posterKey: string | null } | null>;
export function deleteItem(sql: QueryTag, pairId: string, id: string): Promise<{ objectKey: string; posterKey: string | null } | null>;
export async function deleteItem(sql: QueryTag, pairId: string, id: string): Promise<{ objectKey: string; posterKey: string | null } | null> {
  const rows = await sql`
    DELETE FROM album_items WHERE pair_id = ${pairId} AND id = ${id}
    RETURNING object_key, poster_key
  `;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  return typeof record.object_key === "string" && (typeof record.poster_key === "string" || record.poster_key === null)
    ? { objectKey: record.object_key, posterKey: record.poster_key } : null;
}
