import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidRoomCode } from "@/lib/room/code";
import { isKeepsakeKey, presignKeepsake } from "@/lib/storage/objects";
import { newShareId, rememberKeepsake } from "@/lib/keepsakes/store";
import {
  MAX_UPLOAD_MB,
  keepsakeKey,
  randomToken,
  type KeepsakeKind,
} from "@/lib/photo/keepsake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: readonly KeepsakeKind[] = ["strip", "clip"];
/** Only the shapes this app itself produces. */
const EXTENSIONS = new Set(["png", "webm", "mp4"]);
/**
 * What a keepsake is allowed to be stored as.
 *
 * An allowlist rather than a passthrough: the signed URL is issued for exactly
 * one content type, so an unchecked value would let a caller have this app
 * sign a link serving whatever it liked from our own bucket.
 */
const CONTENT_TYPES: Record<KeepsakeKind, readonly string[]> = {
  strip: ["image/png"],
  clip: ["video/mp4", "video/webm"],
};

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Hands out a signed pair of links for one keepsake: one to upload to, one to
 * download from.
 *
 * The file itself never passes through here, and that is the whole point of
 * the two-step shape. This app runs on Vercel, whose functions refuse request
 * bodies over about four and a half megabytes, while a live-photo strip runs
 * to tens. So the browser asks for permission, gets a signed URL, and talks to
 * storage directly — which also means a photograph is never sitting in this
 * app's memory or its logs.
 *
 * The room's 24-hour life is enforced here as well as in signalling. A link
 * minted from a closed room would outlive the evening that made it, and the
 * download link is deliberately signed to expire on the same clock.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("expected a json body");
  }

  const { room, kind, extension, contentType, sizeBytes } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof room !== "string" || !isValidRoomCode(room)) {
    return bad("invalid room code");
  }
  if (typeof kind !== "string" || !KINDS.includes(kind as KeepsakeKind)) {
    return bad("invalid keepsake kind");
  }
  if (typeof extension !== "string" || !EXTENSIONS.has(extension)) {
    return bad("invalid file type");
  }
  if (
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return bad("invalid size");
  }

  const asKind = kind as KeepsakeKind;
  if (
    typeof contentType !== "string" ||
    !CONTENT_TYPES[asKind].includes(contentType)
  ) {
    return bad("invalid content type");
  }
  // Checked again on the server, because the client's limit is a courtesy to
  // the person waiting and this one is the actual rule. A signed URL is a
  // capability: whatever it permits is what will end up in the bucket.
  if (sizeBytes > MAX_UPLOAD_MB[asKind] * 1024 * 1024) {
    return bad("too large");
  }

  const code = room.toUpperCase();

  const sql = db();
  const open = (await sql`
    SELECT 1 FROM couples WHERE code = ${code} AND expires_at > now()
  `) as unknown[];

  if (open.length === 0) {
    // Gone rather than Bad Request, matching signalling: the code was well
    // formed and may well have been real. Its day is simply over.
    return NextResponse.json({ error: "this room has closed" }, { status: 410 });
  }

  // The key is built HERE, never accepted from the caller. A signed PUT is
  // permission to write to exactly one path, so letting a client name that
  // path would turn this endpoint into write access to the whole bucket.
  const key = keepsakeKey(code, asKind, extension, randomToken());
  if (!isKeepsakeKey(key)) return bad("could not name that file");

  // Only the upload link is needed here. The download link is minted fresh
  // when someone opens the share page, so a code scanned hours later never
  // carries one that expired in the meantime.
  const signed = await presignKeepsake(key, contentType);
  if (signed === null) {
    // Configured storage is optional: without it the booth still works and
    // only the QR modes are unavailable. Say so plainly rather than failing
    // in a way that reads like a bug.
    return NextResponse.json(
      { error: "sharing by QR is not set up for this app yet" },
      { status: 503 },
    );
  }

  // The short id, not the signed link, is what the QR will carry. A presigned
  // URL is six hundred-odd characters and makes a code dense enough that a
  // phone camera has to work at it; ten characters scans first time.
  const shareId = newShareId();
  const stored = await rememberKeepsake(sql, {
    id: shareId,
    roomCode: code,
    objectKey: key,
    kind: asKind,
    contentType,
  });
  if (!stored) {
    // The room closed between the check above and this write. Rare, but the
    // insert is the authority and it said no.
    return NextResponse.json({ error: "this room has closed" }, { status: 410 });
  }

  return NextResponse.json(
    {
      uploadUrl: signed.uploadUrl,
      shareUrl: new URL(`/k/${shareId}`, request.url).toString(),
      key,
    },
    { status: 200 },
  );
}
