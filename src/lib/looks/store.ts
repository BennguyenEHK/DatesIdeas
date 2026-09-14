import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { isHexColor, isLookId, type CustomLook } from "./types";

type QueryTag = (strings: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown>;

export interface BoothLookRow {
  id: string;
  pairId: string;
  name: string;
  shots: 1 | 2 | 3 | 4;
  ink: string;
  backdropKey: string;
  overlayKey: string;
  createdAt: string;
}

function instant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

function readRow(value: unknown): BoothLookRow | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const createdAt = instant(row.created_at);
  if (
    !isLookId(row.id) ||
    typeof row.pair_id !== "string" ||
    typeof row.name !== "string" ||
    !(row.shots === 1 || row.shots === 2 || row.shots === 3 || row.shots === 4) ||
    !isHexColor(row.ink) ||
    typeof row.backdrop_key !== "string" ||
    typeof row.overlay_key !== "string" ||
    createdAt === null
  )
    return null;
  return {
    id: row.id,
    pairId: row.pair_id,
    name: row.name,
    shots: row.shots,
    ink: row.ink,
    backdropKey: row.backdrop_key,
    overlayKey: row.overlay_key,
    createdAt,
  };
}

export async function listLooks(sql: QueryTag, pairId: string): Promise<BoothLookRow[]> {
  const rows = await sql`
    SELECT id, pair_id, name, shots, ink, backdrop_key, overlay_key, created_at
    FROM booth_looks WHERE pair_id = ${pairId} ORDER BY created_at DESC
  `;
  return Array.isArray(rows) ? rows.map(readRow).filter((row): row is BoothLookRow => row !== null) : [];
}

export async function lookCount(sql: QueryTag, pairId: string): Promise<number> {
  const rows = await sql`SELECT count(*)::int AS n FROM booth_looks WHERE pair_id = ${pairId}`;
  const n = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined)?.n : undefined;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export async function insertLook(sql: QueryTag, look: Omit<BoothLookRow, "createdAt">): Promise<boolean> {
  const rows = await sql`
    INSERT INTO booth_looks (id, pair_id, name, shots, ink, backdrop_key, overlay_key)
    VALUES (${look.id}, ${look.pairId}, ${look.name}, ${look.shots}, ${look.ink},
      ${look.backdropKey}, ${look.overlayKey}) RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export async function deleteLook(
  sql: QueryTag,
  pairId: string,
  id: string,
): Promise<Pick<BoothLookRow, "backdropKey" | "overlayKey"> | null> {
  const rows = await sql`
    DELETE FROM booth_looks WHERE pair_id = ${pairId} AND id = ${id}
    RETURNING backdrop_key, overlay_key
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  return typeof value.backdrop_key === "string" && typeof value.overlay_key === "string"
    ? { backdropKey: value.backdrop_key, overlayKey: value.overlay_key }
    : null;
}

export function toCustomLook(row: BoothLookRow, backdropUrl: string, overlayUrl: string): CustomLook {
  return {
    id: row.id,
    name: row.name,
    shots: row.shots,
    ink: row.ink,
    backdropUrl,
    overlayUrl,
    createdAt: row.createdAt,
  };
}

const RECEIPT_LABEL = "festibooth booth look receipt v1";

export function looksReceiptSecret(): string | null {
  const secret = process.env.NEON_STORAGE_SECRET_ACCESS_KEY?.trim();
  return secret ? secret : null;
}

function receiptBytes(secret: string, pairId: string, id: string, backdrop: string, overlay: string): Buffer {
  return createHmac("sha256", secret)
    .update(`${RECEIPT_LABEL}\n${pairId}\n${id}\n${backdrop}\n${overlay}`)
    .digest();
}

export function lookReceipt(
  secret: string,
  pairId: string,
  id: string,
  backdrop: string,
  overlay: string,
): string {
  return receiptBytes(secret, pairId, id, backdrop, overlay).toString("base64url");
}

export function receiptMatchesLook(
  secret: string,
  pairId: string,
  id: string,
  backdrop: string,
  overlay: string,
  receipt: unknown,
): boolean {
  if (typeof receipt !== "string" || receipt.length === 0) return false;
  const expected = receiptBytes(secret, pairId, id, backdrop, overlay);
  const given = Buffer.from(receipt, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
