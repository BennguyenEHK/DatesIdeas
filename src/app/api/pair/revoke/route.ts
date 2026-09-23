import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pairFromRequest, ticketFromRequest } from "@/lib/pair/session";
import { keyIdForTicket, revokeKey } from "@/lib/pair/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const rows: unknown = await client(strings, ...values);
    return rows as Record<string, unknown>[];
  };
}

function unknownKey() {
  return NextResponse.json({ error: "unknown key" }, { status: 404 });
}

/**
 * Takes one device off the caller's album: the Undo after "A new device
 * joined your album".
 *
 * Never the caller's own key, because a device signing itself out from the
 * very screen that offered Undo would be the opposite of what was asked. Never
 * another pair's key either; the delete is scoped by the caller's pair, so
 * such an id simply matches nothing and reads as unknown.
 */
export async function POST(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let keyId: unknown = null;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      keyId = (body as Record<string, unknown>).keyId;
    }
  } catch {
    // An unreadable body is treated like a missing key id, just below.
  }
  if (typeof keyId !== "string" || keyId.length === 0 || keyId.length > 64) {
    return unknownKey();
  }

  // pairFromRequest has already accepted this request's ticket, so there is
  // one to look up.
  const ticket = ticketFromRequest(request);
  const ownKeyId = ticket === null ? null : await keyIdForTicket(sql, ticket);
  if (ownKeyId === keyId) {
    return NextResponse.json(
      { error: "that is this device's key" },
      { status: 400 },
    );
  }

  const revoked = await revokeKey(sql, pair.id, keyId);
  if (!revoked) return unknownKey();
  return NextResponse.json({ revoked: true });
}
