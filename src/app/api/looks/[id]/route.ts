import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteLook } from "@/lib/looks/store";
import { pairFromRequest } from "@/lib/pair/session";
import { deleteKeys } from "@/lib/storage/objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const deleted = await deleteLook(sql, pair.id, id);
  if (deleted === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteKeys([deleted.backdropKey, deleted.overlayKey]).catch(() => 0);
  return NextResponse.json({ ok: true });
}
