import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidRoomCode } from "@/lib/room/code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** List finished sessions for a room. */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code || !isValidRoomCode(code)) return bad("invalid room code");

  const sql = db();
  const rows = await sql`
    SELECT id, started_at, ended_at, memes_sent
    FROM sessions
    WHERE couple_code = ${code.toUpperCase()}
      AND ended_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 50
  `;

  return NextResponse.json({ sessions: rows });
}

/** Open a session when the call connects. */
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

  await sql`
    INSERT INTO couples (code) VALUES (${room})
    ON CONFLICT (code) DO NOTHING
  `;

  const rows = (await sql`
    INSERT INTO sessions (couple_code) VALUES (${room})
    RETURNING id
  `) as { id: string }[];

  const id = rows[0].id;

  await sql`
    INSERT INTO participants (session_id, identity, name)
    VALUES (${id}, ${identity}, ${typeof name === "string" ? name : null})
    ON CONFLICT (session_id, identity) DO NOTHING
  `;

  return NextResponse.json({ id }, { status: 201 });
}
