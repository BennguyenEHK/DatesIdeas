import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidRoomCode } from "@/lib/room/code";
import { MAX_REMEMBERED_ROOMS } from "@/lib/history/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * The rooms being asked about, cleaned up.
 *
 * A room code lasts a day, so "your history" spans many of them and the
 * browser sends the whole list it remembers. That list arrives in a URL, which
 * is not the browser: it is re-validated, deduplicated and capped here rather
 * than trusted, so a hand-written request cannot turn the log into an
 * unbounded query.
 */
function requestedCodes(url: URL): string[] {
  const raw = [
    ...(url.searchParams.get("codes")?.split(",") ?? []),
    // The single-code form predates the list and still reads well in a link.
    url.searchParams.get("code") ?? "",
  ];
  const seen = new Set<string>();
  for (const value of raw) {
    const code = value.trim().toUpperCase();
    if (code !== "" && isValidRoomCode(code)) seen.add(code);
    if (seen.size >= MAX_REMEMBERED_ROOMS) break;
  }
  return [...seen];
}

/** List finished sessions across every room this device has been in. */
export async function GET(request: Request) {
  const codes = requestedCodes(new URL(request.url));
  if (codes.length === 0) return bad("invalid room code");

  const sql = db();
  const rows = await sql`
    SELECT id, started_at, ended_at, memes_sent
    FROM sessions
    WHERE couple_code = ANY(${codes}::text[])
      AND ended_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 50
  `;

  return NextResponse.json({ sessions: rows });
}

/**
 * Open a session when the call connects.
 *
 * This no longer creates the room. It used to, with ON CONFLICT DO NOTHING,
 * back when a room was nothing but a row that had to exist somewhere — but now
 * that rooms have a life, creating one here would hand a fresh 24 hours to any
 * code posted at this endpoint, quietly routing around the signalling gate.
 *
 * The room is deliberately not checked for expiry, only for existence. A call
 * that outlives its room keeps going, and the evening it spends is exactly
 * what this table is for.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("expected a json body");
  }
  const { code, identity, name } = (body ?? {}) as Record<string, unknown>;

  if (typeof code !== "string" || !isValidRoomCode(code)) {
    return bad("invalid room code");
  }
  if (typeof identity !== "string" || !UUID_RE.test(identity)) {
    return bad("invalid identity");
  }

  const sql = db();
  const room = code.toUpperCase();

  const rows = (await sql`
    INSERT INTO sessions (couple_code)
    SELECT ${room}
    WHERE EXISTS (SELECT 1 FROM couples WHERE code = ${room})
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "no such room" }, { status: 410 });
  }

  const id = rows[0].id;

  await sql`
    INSERT INTO participants (session_id, identity, name)
    VALUES (${id}, ${identity}, ${typeof name === "string" ? name : null})
    ON CONFLICT (session_id, identity) DO NOTHING
  `;

  return NextResponse.json({ id }, { status: 201 });
}
