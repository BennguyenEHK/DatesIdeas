import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pairFromRequest, ticketCookie } from "@/lib/pair/session";
import { createPair, rotateTicket } from "@/lib/pair/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const rows: unknown = await client(strings, ...values);
    return rows as Record<string, unknown>[];
  };
}

export async function POST(request: Request) {
  let rotate = new URL(request.url).searchParams.get("rotate") === "1";
  if (!rotate) {
    try {
      const body: unknown = await request.json();
      rotate = typeof body === "object" && body !== null && (body as Record<string, unknown>).rotate === true;
    } catch { /* An empty create request is valid. */ }
  }
  const sql = queryTag();
  if (rotate) {
    const pair = await pairFromRequest(sql, request);
    if (pair === null) return unauthorized();
    const ticket = await rotateTicket(sql, pair.id);
    if (ticket === null) return unauthorized();
    const response = NextResponse.json({ ticket });
    response.cookies.set(ticketCookie(ticket));
    return response;
  }
  // Refuse to mint a second album for a device that already has one.
  //
  // The cookie this would set replaces the only key to the previous pair, and
  // album_items hangs off pairs(id) -- so an accidental second create is the
  // one action in this app that silently destroys access to something
  // irreplaceable. A warning on the page is not a guard; this is. `force=1`
  // remains for the person who genuinely means it.
  const existing = await pairFromRequest(sql, request);
  if (existing !== null && new URL(request.url).searchParams.get("force") !== "1") {
    return NextResponse.json(
      { error: "this device already has an album", alreadyPaired: true },
      { status: 409 },
    );
  }

  const created = await createPair(sql);
  if (created === null) return NextResponse.json({ error: "could not create pair" }, { status: 503 });
  const response = NextResponse.json({ ticket: created.ticket }, { status: 201 });
  response.cookies.set(ticketCookie(created.ticket));
  return response;
}
