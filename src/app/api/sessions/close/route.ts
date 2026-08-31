import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Close a session and record its reaction totals.
 *
 * This is a POST on its own path rather than a PATCH on /api/sessions because
 * the caller is usually `navigator.sendBeacon`, which can only issue a POST.
 * Closing the tab is how a date night normally ends, so this is the path that
 * actually has to work.
 *
 * Counts arrive once, here, at the end — never per gesture.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a json body" }, { status: 400 });
  }

  const { id, memes } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }

  const counts =
    memes !== null && typeof memes === "object" ? (memes as object) : {};

  await db()`
    UPDATE sessions
    SET ended_at = now(), memes_sent = ${JSON.stringify(counts)}::jsonb
    WHERE id = ${id} AND ended_at IS NULL
  `;

  return NextResponse.json({ ok: true });
}
