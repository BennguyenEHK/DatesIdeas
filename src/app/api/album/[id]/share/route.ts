import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pairFromRequest } from "@/lib/pair/session";
import { isValidRoomCode } from "@/lib/room/code";
import { newShareId, rememberKeepsake } from "@/lib/keepsakes/store";
import { isKeepsakeKey } from "@/lib/storage/objects";
import { listItems } from "@/lib/album/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function queryTag() {
  const client = db();
  return async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}

/**
 * Makes an album item scannable, without uploading it again.
 *
 * A QR carries a link, not a file, so sharing anything by QR needs a public
 * page pointing at it — which is exactly what a keepsake row already is. The
 * naive version of this uploads the same fifty megabytes a second time so it
 * can have a keepsake key; this instead points a keepsake row at the object
 * that is already in the bucket.
 *
 * The share therefore inherits the keepsake rules rather than the album's: it
 * needs an open room, and it dies when that room does. That is the right way
 * round. An album item lives forever because it is yours; a link anybody
 * holding a QR can open should not.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a json body" }, { status: 400 });
  }
  const room = (body as Record<string, unknown> | null)?.room;
  if (typeof room !== "string" || !isValidRoomCode(room)) {
    return NextResponse.json({ error: "invalid room code" }, { status: 400 });
  }

  const { id } = await params;

  // Read through the pair-scoped listing rather than fetching by id alone, so
  // an item belonging to somebody else cannot be made public by guessing its id.
  const items = await listItems(sql, pair.id);
  const item = items.find((candidate) => candidate.id === id) ?? null;
  if (item === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!isKeepsakeKey(item.objectKey)) {
    return NextResponse.json({ error: "that cannot be shared" }, { status: 400 });
  }

  const code = room.toUpperCase();
  const shareId = newShareId();

  // rememberKeepsake refuses in one statement if the room has closed, so
  // expiry cannot slip between a check and the insert.
  const stored = await rememberKeepsake(sql, {
    id: shareId,
    roomCode: code,
    objectKey: item.objectKey,
    // Everything shareable from an album is either a still or something that
    // moves, and the keepsake page only needs to know which.
    kind: item.kind === "strip" || item.kind === "photo" ? "strip" : "clip",
    contentType: item.contentType,
  });
  if (!stored) {
    return NextResponse.json({ error: "this room has closed" }, { status: 410 });
  }

  return NextResponse.json({
    shareUrl: new URL(`/k/${shareId}`, request.url).toString(),
  });
}
