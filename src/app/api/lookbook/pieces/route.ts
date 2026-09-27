import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newShareId } from "@/lib/keepsakes/store";
import { pieceKey, isLookbookKeyFor } from "@/lib/lookbook/keys";
import {
  insertPiece,
  listPieces,
  pieceCount,
  pieceReceipt,
  pieceReceiptSecret,
  receiptMatchesPiece,
  toPiece,
} from "@/lib/lookbook/store";
import {
  isLookbookId,
  isPerson,
  isPieceContentType,
  isPieceKind,
  isPieceLabel,
  PIECE_CAP,
  PIECE_SOURCE_MAX_BYTES,
} from "@/lib/lookbook/types";
import { pairFromRequest } from "@/lib/pair/session";
import { presignKeepsake } from "@/lib/storage/objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const unavailable = () =>
  NextResponse.json({ error: "Lookbook storage is not set up yet." }, { status: 503 });
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function bytes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= PIECE_SOURCE_MAX_BYTES
  );
}
function queryTag() {
  const client = db();
  return async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}

export async function GET(request: Request) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!pieceReceiptSecret()) return unavailable();
  const rows = await listPieces(sql, pair.id);
  const pieces = await Promise.all(
    rows.map(async (row) => {
      const signed = await presignKeepsake(row.objectKey, row.contentType);
      return signed ? toPiece(row, signed.downloadUrl) : null;
    }),
  );
  const ready = pieces.filter((piece): piece is NonNullable<typeof piece> => piece !== null);
  if (rows.length > 0 && ready.length === 0) return unavailable();
  return NextResponse.json({ pieces: ready });
}
export async function POST(request: Request) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown> | null;
  try {
    body = record(await request.json());
  } catch {
    return bad("Expected a JSON body.");
  }
  if (!body || !isPieceContentType(body.contentType) || !bytes(body.bytes))
    return bad("Choose a supported image no larger than 12MB.");
  if ((await pieceCount(sql, pair.id)) >= PIECE_CAP)
    return NextResponse.json({ error: "You can keep up to 200 pieces." }, { status: 409 });
  const secret = pieceReceiptSecret();
  if (!secret) return unavailable();
  const id = newShareId(),
    key = pieceKey(pair.id, id, body.contentType),
    signed = await presignKeepsake(key, body.contentType);
  if (!signed) return unavailable();
  return NextResponse.json({
    id,
    key,
    uploadUrl: signed.uploadUrl,
    receipt: pieceReceipt(secret, pair.id, id, key, body.contentType, body.bytes),
  });
}
export async function PUT(request: Request) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown> | null;
  try {
    body = record(await request.json());
  } catch {
    return bad("Expected a JSON body.");
  }
  if (
    !body ||
    !isLookbookId(body.id) ||
    !isPieceContentType(body.contentType) ||
    !bytes(body.bytes) ||
    !isPieceKind(body.kind) ||
    !isPieceLabel(body.label) ||
    !isPerson(body.addedBy) ||
    !isLookbookKeyFor(pair.id, body.key)
  )
    return bad("Invalid Lookbook piece.");
  const expectedKey = pieceKey(pair.id, body.id, body.contentType);
  if (body.key !== expectedKey) return bad("Invalid Lookbook piece key.");
  const secret = pieceReceiptSecret();
  if (!secret) return unavailable();
  if (
    !receiptMatchesPiece(
      secret,
      pair.id,
      body.id,
      body.key,
      body.contentType,
      body.bytes,
      body.receipt,
    )
  )
    return bad("Invalid piece receipt.");
  const row = await insertPiece(sql, {
    id: body.id,
    pairId: pair.id,
    objectKey: body.key,
    contentType: body.contentType,
    bytes: body.bytes,
    kind: body.kind,
    label: body.label,
    addedBy: body.addedBy,
  });
  if (!row) return NextResponse.json({ error: "Could not save this piece." }, { status: 409 });
  const signed = await presignKeepsake(row.objectKey, row.contentType);
  if (!signed) return unavailable();
  return NextResponse.json({ piece: toPiece(row, signed.downloadUrl) });
}
