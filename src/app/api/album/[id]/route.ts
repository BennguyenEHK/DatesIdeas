import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteItem, updateItem } from "@/lib/album/items";
import { pairFromRequest } from "@/lib/pair/session";
import { clampHappenedAt } from "@/lib/album/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function unauthorized() { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  let body: unknown;
  try { body = await request.json(); } catch { return bad("expected a json body"); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return bad("invalid update");
  const patch = body as Record<string, unknown>;
  if ((patch.loved !== undefined && typeof patch.loved !== "boolean") ||
    (patch.caption !== undefined && patch.caption !== null && typeof patch.caption !== "string") ||
    (patch.happenedAt !== undefined && typeof patch.happenedAt !== "string")) return bad("invalid update");
  const { id } = await params;
  const updated = await updateItem(sql, pair.id, id, {
    ...(patch.loved === undefined ? {} : { loved: patch.loved }),
    ...(patch.caption === undefined ? {} : { caption: patch.caption as string | null }),
    ...(patch.happenedAt === undefined ? {} : { happenedAt: clampHappenedAt(patch.happenedAt) }),
  });
  return updated ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  const { id } = await params;
  const deleted = await deleteItem(sql, pair.id, id);
  if (deleted === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Bucket deletion is intentionally separate: object storage cleanup must not
  // turn a successful authorization-bound database delete into a partial failure.
  return NextResponse.json({ ok: true });
}
