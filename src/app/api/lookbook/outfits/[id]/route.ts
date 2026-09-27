import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteOutfit, hasPieces, toOutfit, updateOutfit } from "@/lib/lookbook/store";
import {
  isLayout,
  isLookbookId,
  isOutfitName,
  isOutfitNote,
  isPerson,
  isWearOn,
} from "@/lib/lookbook/types";
import { pairFromRequest } from "@/lib/pair/session";
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
  const { id } = await params;
  let body: Record<string, unknown> | null;
  try {
    body = record(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const fields = ["name", "wearOn", "note", "layout", "love"];
  if (
    !isLookbookId(id) ||
    !body ||
    !fields.some((field) => Object.hasOwn(body, field)) ||
    (Object.hasOwn(body, "name") && !isOutfitName(body.name)) ||
    (Object.hasOwn(body, "wearOn") && body.wearOn !== null && !isWearOn(body.wearOn)) ||
    (Object.hasOwn(body, "note") && !isOutfitNote(body.note)) ||
    (Object.hasOwn(body, "layout") && !isLayout(body.layout))
  )
    return NextResponse.json({ error: "Invalid outfit update." }, { status: 400 });
  const layout = body.layout;
  // The structural check above makes the ids safe to ask the pair-scoped lookup about.
  if (
    Object.hasOwn(body, "layout") &&
    isLayout(layout) &&
    !(await hasPieces(
      sql,
      pair.id,
      layout.map((place) => place.pieceId),
    ))
  )
    return NextResponse.json({ error: "A board piece is not in this wardrobe." }, { status: 400 });
  let love: { by: string; on: boolean } | undefined;
  if (Object.hasOwn(body, "love")) {
    const given = record(body.love);
    if (!given || !isPerson(given.by) || typeof given.on !== "boolean")
      return NextResponse.json({ error: "Invalid outfit update." }, { status: 400 });
    // Applied by the database in the same statement as everything else, so
    // two hearts at the same moment both land.
    love = { by: given.by, on: given.on };
  }
  const row = await updateOutfit(sql, pair.id, id, {
    name: body.name as string | undefined,
    wearOn: Object.hasOwn(body, "wearOn") ? (body.wearOn as string | null) : undefined,
    note: body.note as string | undefined,
    layout: body.layout as never,
    love,
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ outfit: toOutfit(row) });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isLookbookId(id) || !(await deleteOutfit(sql, pair.id, id)))
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
