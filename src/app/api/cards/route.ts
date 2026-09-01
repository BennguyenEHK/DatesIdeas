import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isMood, type Card } from "@/lib/cards/types";

export const runtime = "nodejs";

/**
 * The whole deck, fetched once when a room opens.
 *
 * All of it at once rather than a card at a time: it is a few hundred short
 * strings, and holding it client-side means drawing a question costs nothing
 * and works through a blip in the connection. A per-draw round trip would put
 * the database in the middle of a live conversation for no benefit.
 *
 * Cached for an hour — the deck is content that changes rarely, and every
 * room otherwise re-reads the same rows.
 */
export async function GET() {
  try {
    const sql = db();
    const rows = (await sql`
      SELECT id, text, mood FROM card_game ORDER BY id
    `) as Record<string, unknown>[];

    // The mood column is CHECK-constrained, so a bad row means the constraint
    // was bypassed. Drop it rather than letting it reach the UI.
    const cards: Card[] = rows.flatMap((r) =>
      isMood(r.mood)
        ? [{ id: Number(r.id), text: String(r.text), mood: r.mood }]
        : [],
    );

    return NextResponse.json(
      { cards },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    // The card game is an extra. A database that is asleep or unreachable must
    // never take the video call down with it.
    return NextResponse.json({ cards: [], degraded: "deck-unavailable" });
  }
}
