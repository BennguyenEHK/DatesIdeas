import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidRoomCode } from "@/lib/room/code";
import { karaokeKey } from "@/lib/karaoke/keys";
import { presignKeepsake } from "@/lib/storage/objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A 360p song is up to about this big (helper/extract.mjs caps it here). */
const MAX_TRACK_BYTES = 60 * 1024 * 1024;
/** The only thing a karaoke slot is signed for. */
const TRACK_CONTENT_TYPE = "video/mp4";

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Hands out a signed pair of links for one karaoke song: one to upload to, one
 * for the other person to download from.
 *
 * The song never passes through here, for the same reason as a keepsake: this
 * app runs on Vercel, whose functions refuse bodies over about four and a half
 * megabytes. Sending it through storage also means a flaky call cannot stall
 * it, which is the whole reason this route exists.
 *
 * Both limits are enforced here as well as in the browser. A signed URL is a
 * capability, so the content type and the room are checked before one is made.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("expected a json body");
  }

  const { code, bytes, contentType } = (body ?? {}) as Record<string, unknown>;

  if (typeof code !== "string" || !isValidRoomCode(code)) {
    return NextResponse.json({ error: "this room is not open" }, { status: 404 });
  }
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > MAX_TRACK_BYTES
  ) {
    return bad("invalid size");
  }
  if (contentType !== TRACK_CONTENT_TYPE) {
    return bad("invalid content type");
  }

  const room = code.toUpperCase();

  const sql = db();
  const open = (await sql`
    SELECT 1 FROM couples WHERE code = ${room} AND expires_at > now()
  `) as unknown[];

  if (open.length === 0) {
    // Not found rather than gone: either the code was never a room or its day
    // is over, and the caller can do nothing different about the two.
    return NextResponse.json({ error: "this room is not open" }, { status: 404 });
  }

  // The key is built HERE, never accepted from the caller: a signed PUT is
  // permission to write to exactly one path.
  const signed = await presignKeepsake(karaokeKey(room), TRACK_CONTENT_TYPE);
  if (signed === null) {
    // Storage is optional. The browser treats this as "send it over the call".
    return NextResponse.json({ error: "song storage is not set up" }, { status: 503 });
  }

  return NextResponse.json(
    { uploadUrl: signed.uploadUrl, downloadUrl: signed.downloadUrl, key: signed.key },
    { status: 200 },
  );
}
