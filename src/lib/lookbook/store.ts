import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  isLayout,
  isLookbookId,
  isOutfitName,
  isOutfitNote,
  isPerson,
  isPieceContentType,
  isPieceKind,
  isPieceLabel,
  isWearOn,
  type LookbookPiece,
  type Outfit,
  type PieceContentType,
  type PieceKind,
  type Placement,
} from "./types";

type QueryTag = (strings: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown>;

export interface PieceRow {
  id: string;
  pairId: string;
  objectKey: string;
  contentType: PieceContentType;
  bytes: number;
  kind: PieceKind;
  label: string;
  addedBy: string;
  createdAt: string;
}
export interface OutfitRow {
  id: string;
  pairId: string;
  name: string;
  wearOn: string | null;
  note: string;
  createdBy: string;
  lovedBy: string[];
  layout: Placement[];
  createdAt: string;
  updatedAt: string;
}

function instant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function readPiece(value: unknown): PieceRow | null {
  const row = record(value);
  if (!row) return null;
  const createdAt = instant(row.created_at);
  if (
    !isLookbookId(row.id) ||
    typeof row.pair_id !== "string" ||
    typeof row.object_key !== "string" ||
    !isPieceContentType(row.content_type) ||
    typeof row.bytes !== "number" ||
    !Number.isSafeInteger(row.bytes) ||
    row.bytes < 1 ||
    !isPieceKind(row.kind) ||
    !isPieceLabel(row.label) ||
    !isPerson(row.added_by) ||
    !createdAt
  )
    return null;
  return {
    id: row.id,
    pairId: row.pair_id,
    objectKey: row.object_key,
    contentType: row.content_type,
    bytes: row.bytes,
    kind: row.kind,
    label: row.label,
    addedBy: row.added_by,
    createdAt,
  };
}
function readOutfit(value: unknown): OutfitRow | null {
  const row = record(value);
  if (!row) return null;
  const createdAt = instant(row.created_at),
    updatedAt = instant(row.updated_at);
  const wearOn =
    row.wear_on === null ? null : typeof row.wear_on === "string" ? row.wear_on.slice(0, 10) : null;
  if (
    !isLookbookId(row.id) ||
    typeof row.pair_id !== "string" ||
    !isOutfitName(row.name) ||
    (wearOn !== null && !isWearOn(wearOn)) ||
    !isOutfitNote(row.note) ||
    !isPerson(row.created_by) ||
    !Array.isArray(row.loved_by) ||
    !row.loved_by.every(isPerson) ||
    !isLayout(row.layout) ||
    !createdAt ||
    !updatedAt
  )
    return null;
  return {
    id: row.id,
    pairId: row.pair_id,
    name: row.name,
    wearOn,
    note: row.note,
    createdBy: row.created_by,
    lovedBy: row.loved_by,
    layout: row.layout,
    createdAt,
    updatedAt,
  };
}
function rowsOf<T>(rows: unknown, read: (value: unknown) => T | null): T[] {
  return Array.isArray(rows) ? rows.map(read).filter((row): row is T => row !== null) : [];
}
export async function listPieces(sql: QueryTag, pairId: string): Promise<PieceRow[]> {
  return rowsOf(
    await sql`SELECT id, pair_id, object_key, content_type, bytes, kind, label, added_by, created_at FROM lookbook_pieces WHERE pair_id = ${pairId} ORDER BY created_at DESC`,
    readPiece,
  );
}
export async function pieceCount(sql: QueryTag, pairId: string): Promise<number> {
  const rows = await sql`SELECT count(*)::int AS n FROM lookbook_pieces WHERE pair_id = ${pairId}`;
  const n = Array.isArray(rows) ? record(rows[0])?.n : null;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
export async function insertPiece(
  sql: QueryTag,
  piece: Omit<PieceRow, "createdAt">,
): Promise<PieceRow | null> {
  const rows =
    await sql`INSERT INTO lookbook_pieces (id, pair_id, object_key, content_type, bytes, kind, label, added_by) VALUES (${piece.id}, ${piece.pairId}, ${piece.objectKey}, ${piece.contentType}, ${piece.bytes}, ${piece.kind}, ${piece.label}, ${piece.addedBy}) RETURNING id, pair_id, object_key, content_type, bytes, kind, label, added_by, created_at`;
  return rowsOf(rows, readPiece)[0] ?? null;
}
export async function updatePiece(
  sql: QueryTag,
  pairId: string,
  id: string,
  patch: { kind?: PieceKind; label?: string },
): Promise<PieceRow | null> {
  const rows =
    await sql`UPDATE lookbook_pieces SET kind = COALESCE(${patch.kind ?? null}, kind), label = COALESCE(${patch.label ?? null}, label) WHERE pair_id = ${pairId} AND id = ${id} RETURNING id, pair_id, object_key, content_type, bytes, kind, label, added_by, created_at`;
  return rowsOf(rows, readPiece)[0] ?? null;
}
export async function deletePiece(
  sql: QueryTag,
  pairId: string,
  id: string,
): Promise<PieceRow | null> {
  const rows =
    await sql`DELETE FROM lookbook_pieces WHERE pair_id = ${pairId} AND id = ${id} RETURNING id, pair_id, object_key, content_type, bytes, kind, label, added_by, created_at`;
  return rowsOf(rows, readPiece)[0] ?? null;
}
export async function stripPieceFromOutfits(
  sql: QueryTag,
  pairId: string,
  pieceId: string,
): Promise<void> {
  await sql`UPDATE lookbook_outfits SET layout = (SELECT COALESCE(jsonb_agg(place), '[]'::jsonb) FROM jsonb_array_elements(layout) place WHERE place->>'pieceId' <> ${pieceId}), updated_at = now() WHERE pair_id = ${pairId} AND layout @> ${JSON.stringify([{ pieceId }])}::jsonb`;
}
export async function listOutfits(
  sql: QueryTag,
  pairId: string,
  range?: { from: string; to: string },
): Promise<OutfitRow[]> {
  const rows = range
    ? await sql`SELECT id, pair_id, name, to_char(wear_on, 'YYYY-MM-DD') AS wear_on, note, created_by, loved_by, layout, created_at, updated_at FROM lookbook_outfits WHERE pair_id = ${pairId} AND wear_on BETWEEN ${range.from}::date AND ${range.to}::date ORDER BY wear_on`
    : await sql`SELECT id, pair_id, name, to_char(wear_on, 'YYYY-MM-DD') AS wear_on, note, created_by, loved_by, layout, created_at, updated_at FROM lookbook_outfits WHERE pair_id = ${pairId} ORDER BY updated_at DESC`;
  return rowsOf(rows, readOutfit);
}
export async function outfitCount(sql: QueryTag, pairId: string): Promise<number> {
  const rows = await sql`SELECT count(*)::int AS n FROM lookbook_outfits WHERE pair_id = ${pairId}`;
  const n = Array.isArray(rows) ? record(rows[0])?.n : null;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
export async function insertOutfit(
  sql: QueryTag,
  outfit: Omit<OutfitRow, "createdAt" | "updatedAt">,
): Promise<OutfitRow | null> {
  const rows =
    await sql`INSERT INTO lookbook_outfits (id, pair_id, name, wear_on, note, created_by, loved_by, layout) VALUES (${outfit.id}, ${outfit.pairId}, ${outfit.name}, ${outfit.wearOn}, ${outfit.note}, ${outfit.createdBy}, ${outfit.lovedBy}, ${JSON.stringify(outfit.layout)}::jsonb) RETURNING id, pair_id, name, to_char(wear_on, 'YYYY-MM-DD') AS wear_on, note, created_by, loved_by, layout, created_at, updated_at`;
  return rowsOf(rows, readOutfit)[0] ?? null;
}
/**
 * Changes only what the patch carries. A day is decided by its value --
 * undefined leaves it, null clears it -- never by whether the key is present:
 * the route passes `wearOn: undefined` for every save that did not mention it,
 * and testing for the key there wiped the day on each board move and heart.
 */
export async function updateOutfit(
  sql: QueryTag,
  pairId: string,
  id: string,
  patch: Partial<Pick<OutfitRow, "name" | "wearOn" | "note" | "layout">> & {
    /**
     * A heart given or taken back, applied by the database in this same
     * statement. Reading the list, changing it here and writing it back let
     * two people hearting at once each overwrite the other's heart.
     */
    love?: { by: string; on: boolean };
  },
): Promise<OutfitRow | null> {
  const rows =
    await sql`UPDATE lookbook_outfits SET name = COALESCE(${patch.name ?? null}, name), wear_on = CASE WHEN ${patch.wearOn !== undefined} THEN ${patch.wearOn ?? null}::date ELSE wear_on END, note = COALESCE(${patch.note ?? null}, note), layout = CASE WHEN ${patch.layout !== undefined} THEN ${JSON.stringify(patch.layout ?? [])}::jsonb ELSE layout END, loved_by = CASE WHEN ${patch.love === undefined} THEN loved_by WHEN ${patch.love?.on ?? false} THEN (CASE WHEN ${patch.love?.by ?? ""} = ANY(loved_by) THEN loved_by ELSE array_append(loved_by, ${patch.love?.by ?? ""}::text) END) ELSE array_remove(loved_by, ${patch.love?.by ?? ""}::text) END, updated_at = now() WHERE pair_id = ${pairId} AND id = ${id} RETURNING id, pair_id, name, to_char(wear_on, 'YYYY-MM-DD') AS wear_on, note, created_by, loved_by, layout, created_at, updated_at`;
  return rowsOf(rows, readOutfit)[0] ?? null;
}
export async function deleteOutfit(sql: QueryTag, pairId: string, id: string): Promise<boolean> {
  const rows =
    await sql`DELETE FROM lookbook_outfits WHERE pair_id = ${pairId} AND id = ${id} RETURNING id`;
  return Array.isArray(rows) && rows.length > 0;
}
export async function hasPieces(sql: QueryTag, pairId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows =
    await sql`SELECT id FROM lookbook_pieces WHERE pair_id = ${pairId} AND id = ANY(${ids})`;
  return Array.isArray(rows) && rows.length === ids.length;
}
export function toPiece(row: PieceRow, url: string): LookbookPiece {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    addedBy: row.addedBy,
    url,
    createdAt: row.createdAt,
  };
}
export function toOutfit(row: OutfitRow): Outfit {
  return {
    id: row.id,
    name: row.name,
    wearOn: row.wearOn,
    note: row.note,
    createdBy: row.createdBy,
    lovedBy: row.lovedBy,
    layout: row.layout,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
const RECEIPT_LABEL = "festibooth lookbook piece receipt v1";
export function pieceReceiptSecret(): string | null {
  const secret = process.env.NEON_STORAGE_SECRET_ACCESS_KEY?.trim();
  return secret || null;
}
function receiptBytes(
  secret: string,
  pairId: string,
  id: string,
  key: string,
  contentType: string,
  bytes: number,
): Buffer {
  return createHmac("sha256", secret)
    .update(`${RECEIPT_LABEL}\n${pairId}\n${id}\n${key}\n${contentType}\n${bytes}`)
    .digest();
}
export function pieceReceipt(
  secret: string,
  pairId: string,
  id: string,
  key: string,
  contentType: string,
  bytes: number,
): string {
  return receiptBytes(secret, pairId, id, key, contentType, bytes).toString("base64url");
}
export function receiptMatchesPiece(
  secret: string,
  pairId: string,
  id: string,
  key: string,
  contentType: string,
  bytes: number,
  receipt: unknown,
): boolean {
  if (typeof receipt !== "string" || !receipt) return false;
  const expected = receiptBytes(secret, pairId, id, key, contentType, bytes),
    given = Buffer.from(receipt, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
