import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createInvite } from "@/lib/pair/invites";
import { pairFromRequest } from "@/lib/pair/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const rows: unknown = await client(strings, ...values);
    return rows as Record<string, unknown>[];
  };
}

/**
 * Mints a one-time invitation onto the caller's album.
 *
 * Only a device already on the album can ask, and the code it gets back goes
 * straight into the room's data channel for the other device to claim.
 */
export async function POST(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const invite = await createInvite(sql, pair.id);
  return NextResponse.json(invite);
}
