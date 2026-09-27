import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newShareId } from "@/lib/keepsakes/store";
import { insertOutfit, listOutfits, outfitCount, toOutfit } from "@/lib/lookbook/store";
import { isOutfitName, isOutfitNote, isPerson, isWearOn, OUTFIT_CAP } from "@/lib/lookbook/types";
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
function range(request: Request): { from: string; to: string } | null | "invalid" {
  const url = new URL(request.url),
    from = url.searchParams.get("from"),
    to = url.searchParams.get("to");
  if (from === null && to === null) return null;
  if (
    !from ||
    !to ||
    !isWearOn(from) ||
    !isWearOn(to) ||
    from > to ||
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 62
  )
    return "invalid";
  return { from, to };
}
export async function GET(request: Request) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const selected = range(request);
  if (selected === "invalid")
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  return NextResponse.json({
    outfits: (await listOutfits(sql, pair.id, selected ?? undefined)).map(toOutfit),
  });
}
export async function POST(request: Request) {
  const sql = queryTag(),
    pair = await pairFromRequest(sql, request);
  if (!pair) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown> | null;
  try {
    body = record(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "",
    wearOn = body?.wearOn;
  if (
    !body ||
    !isOutfitName(name) ||
    !isPerson(body.createdBy) ||
    (wearOn !== undefined && wearOn !== null && !isWearOn(wearOn)) ||
    (body.note !== undefined && !isOutfitNote(body.note))
  )
    return NextResponse.json({ error: "Invalid outfit." }, { status: 400 });
  if ((await outfitCount(sql, pair.id)) >= OUTFIT_CAP)
    return NextResponse.json({ error: "You can keep up to 100 outfits." }, { status: 409 });
  const row = await insertOutfit(sql, {
    id: newShareId(),
    pairId: pair.id,
    name,
    wearOn: wearOn ?? null,
    note: body.note ?? "",
    createdBy: body.createdBy,
    lovedBy: [],
    layout: [],
  });
  if (!row) return NextResponse.json({ error: "Could not save this outfit." }, { status: 409 });
  return NextResponse.json({ outfit: toOutfit(row) });
}
