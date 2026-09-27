import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  deletePiece,
  pieceReceiptSecret,
  stripPieceFromOutfits,
  toPiece,
  updatePiece,
} from "@/lib/lookbook/store";
import { isLookbookId, isPieceKind, isPieceLabel } from "@/lib/lookbook/types";
import { pairFromRequest } from "@/lib/pair/session";
import { deleteKeys, presignKeepsake } from "@/lib/storage/objects";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!pieceReceiptSecret())
    return NextResponse.json({ error: "Lookbook storage is not set up yet." }, { status: 503 });
  const { id } = await params;
  let body: Record<string, unknown> | null;
  try {
    body = record(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (
    !isLookbookId(id) ||
    !body ||
    (!Object.hasOwn(body, "kind") && !Object.hasOwn(body, "label")) ||
    (Object.hasOwn(body, "kind") && !isPieceKind(body.kind)) ||
    (Object.hasOwn(body, "label") && !isPieceLabel(body.label))
  )
    return NextResponse.json({ error: "Invalid piece update." }, { status: 400 });
  const row = await updatePiece(sql, pair.id, id, {
    kind: body.kind as never,
    label: body.label as never,
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const signed = await presignKeepsake(row.objectKey, row.contentType);
  if (!signed)
    return NextResponse.json({ error: "Lookbook storage is not set up yet." }, { status: 503 });
  return NextResponse.json({ piece: toPiece(row, signed.downloadUrl) });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!pieceReceiptSecret())
    return NextResponse.json({ error: "Lookbook storage is not set up yet." }, { status: 503 });
  if (!isLookbookId(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await deletePiece(sql, pair.id, id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await stripPieceFromOutfits(sql, pair.id, id);
  await deleteKeys([row.objectKey]).catch(() => 0);
  return NextResponse.json({ ok: true });
}
