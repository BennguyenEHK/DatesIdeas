import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidRoomCode, newRoomCode } from "@/lib/room/code";
import { ROOM_TTL_HOURS, type RoomStatus } from "@/lib/room/lifetime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Codes are drawn from 31^6 ≈ 887 million, so a clash with a live room is
 * already vanishingly rare. A handful of attempts turns "vanishingly rare"
 * into "cannot happen" without any risk of spinning.
 */
const MAX_ATTEMPTS = 5;

/**
 * Postgres returns timestamps in its own text format, whose timezone the
 * browser has to infer. Milliseconds since the epoch cannot be misread, so
 * every query here asks for those and this turns them into an instant.
 */
function instant(ms: unknown): string {
  return new Date(Number(ms)).toISOString();
}

/**
 * Open a room and start its day.
 *
 * The code is minted here rather than in the browser so that claiming it and
 * checking it are the same statement. A client-side code would have to be
 * checked and then inserted, and two people creating rooms in that gap could
 * both be told the code was theirs.
 */
export async function POST() {
  const sql = db();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = newRoomCode();

    // An expired code is reusable; a live one is not. The WHERE on DO UPDATE
    // is what decides that, and a row comes back only if we won.
    const rows = (await sql`
      INSERT INTO couples (code, expires_at)
      VALUES (${code}, now() + make_interval(hours => ${ROOM_TTL_HOURS}))
      ON CONFLICT (code) DO UPDATE
        SET created_at = now(), expires_at = excluded.expires_at
        WHERE couples.expires_at <= now()
      RETURNING floor(extract(epoch from expires_at) * 1000) AS expires_ms
    `) as { expires_ms: string }[];

    if (rows.length > 0) {
      return NextResponse.json(
        { code, expiresAt: instant(rows[0].expires_ms) },
        { status: 201 },
      );
    }
  }

  return NextResponse.json(
    { error: "could not find a free room code" },
    { status: 503 },
  );
}

/**
 * Whether a code can still be joined.
 *
 * "Expired" and "missing" are kept apart because they are different things to
 * be told: one evening ended, the other never happened, and a mistyped code
 * deserves to be named as one.
 *
 * Postgres answers the open/closed question with its own now(), so a browser
 * with a wrong clock cannot be shown a door that signalling will not open.
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code || !isValidRoomCode(code)) {
    return NextResponse.json({ error: "invalid room code" }, { status: 400 });
  }

  const sql = db();
  const rows = (await sql`
    SELECT
      (expires_at > now()) AS open,
      floor(extract(epoch from expires_at) * 1000) AS expires_ms
    FROM couples
    WHERE code = ${code.toUpperCase()}
  `) as { open: boolean; expires_ms: string }[];

  if (rows.length === 0) {
    return NextResponse.json({
      status: "missing" satisfies RoomStatus,
      expiresAt: null,
    });
  }

  return NextResponse.json({
    status: (rows[0].open ? "open" : "expired") satisfies RoomStatus,
    expiresAt: instant(rows[0].expires_ms),
  });
}
