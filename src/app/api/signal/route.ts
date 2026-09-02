import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidRoomCode } from "@/lib/room/code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Handshake rows older than this are debris from an earlier session. */
const SIGNAL_TTL_MINUTES = 15;
const MAX_PAYLOAD_BYTES = 64 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Post one signalling message for the other peer to collect.
 *
 * Neon has no realtime channel, so the handshake runs through this table:
 * each peer writes its offer/answer/ICE here and polls GET for the other
 * side's. Rows are transport with a lifetime of seconds, not records.
 *
 * This is also the gate on a room's 24-hour life: a closed room accepts no
 * signals, so no new pair can find each other in it. An evening already in
 * progress is untouched — once connected, nothing it does comes back here.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("expected a json body");
  }

  const { code, from, payload } = (body ?? {}) as Record<string, unknown>;

  if (typeof code !== "string" || !isValidRoomCode(code)) {
    return bad("invalid room code");
  }
  if (typeof from !== "string" || !UUID_RE.test(from)) {
    return bad("invalid identity");
  }
  if (payload === null || typeof payload !== "object") {
    return bad("invalid payload");
  }

  const encoded = JSON.stringify(payload);
  // An SDP is a few kilobytes. Anything far larger is not a handshake.
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    return bad("payload too large");
  }

  const sql = db();
  const room = code.toUpperCase();

  // The room's day is enforced here, and here only. This is the one call that
  // lets two peers find each other, so a check anywhere else would be
  // decoration. Folding it into the insert keeps it to a single round trip and
  // leaves no gap in which the room could expire between the check and the
  // write.
  const inserted = (await sql`
    INSERT INTO signals (room_code, from_identity, payload)
    SELECT ${room}, ${from}, ${encoded}::jsonb
    WHERE EXISTS (
      SELECT 1 FROM couples WHERE code = ${room} AND expires_at > now()
    )
    RETURNING id
  `) as { id: string }[];

  if (inserted.length === 0) {
    // Gone rather than Bad Request: the code was well formed and may well have
    // been real — its day is simply over, or it was never opened. Nothing else
    // happens on this path, because anyone holding a stale link can reach it.
    return NextResponse.json({ error: "this room has closed" }, { status: 410 });
  }

  // Sweep on write rather than on a schedule: these rows are worthless once
  // the handshake completes, and this keeps the table from growing forever
  // without anything to operate.
  await sql`
    DELETE FROM signals
    WHERE created_at < now() - make_interval(mins => ${SIGNAL_TTL_MINUTES})
  `;

  return NextResponse.json({ ok: true }, { status: 201 });
}

/**
 * Collect everything the *other* peer has posted since `after`.
 *
 * Returns a cursor so the next poll only asks for what it has not seen. The
 * caller's own rows are excluded, which is what makes a single shared table
 * work for two peers without either hearing its own echo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const from = url.searchParams.get("from");
  const after = Number(url.searchParams.get("after") ?? "0");

  if (!code || !isValidRoomCode(code)) return bad("invalid room code");
  if (!from || !UUID_RE.test(from)) return bad("invalid identity");
  if (!Number.isFinite(after) || after < 0) return bad("invalid cursor");

  const sql = db();

  const rows = (await sql`
    SELECT id, from_identity, payload
    FROM signals
    WHERE room_code = ${code.toUpperCase()}
      AND from_identity <> ${from}
      AND id > ${after}
    ORDER BY id
    LIMIT 100
  `) as { id: number; from_identity: string; payload: unknown }[];

  const cursor = rows.length > 0 ? Number(rows[rows.length - 1].id) : after;

  return NextResponse.json({
    signals: rows.map((r) => r.payload),
    cursor,
  });
}
