import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { claimInvite } from "@/lib/pair/invites";
import { ticketCookie } from "@/lib/pair/session";
import { addKey } from "@/lib/pair/store";

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
 * The one answer for every failure.
 *
 * Expired, already used, never issued, or not even shaped like a code: the
 * caller is told the same thing each time, so a stranger guessing codes
 * learns nothing about how close a guess came.
 */
function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * Redeems an invitation for a key of this device's own.
 *
 * No ticket is needed to call this; the invitation is the proof. On success
 * the new key goes into the same HttpOnly cookie the /us/<ticket> link sets,
 * so from here on this device is on the album like any other. The key id comes
 * back so the inviting device can offer Undo, and it opens nothing by itself.
 */
export async function POST(request: Request) {
  let code: unknown = null;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      code = (body as Record<string, unknown>).code;
    }
  } catch {
    return unauthorized();
  }
  if (typeof code !== "string") return unauthorized();

  const sql = queryTag();
  const claimed = await claimInvite(sql, code);
  if (claimed === null) return unauthorized();
  const key = await addKey(sql, claimed.pairId);
  if (key === null) return unauthorized();

  const response = NextResponse.json({ paired: true, keyId: key.keyId });
  response.cookies.set(ticketCookie(key.ticket));
  return response;
}
