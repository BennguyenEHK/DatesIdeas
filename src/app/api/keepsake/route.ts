import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidRoomCode } from "@/lib/room/code";
import {
  isKeepsakeKey,
  presignKeepsake,
  DOWNLOAD_URL_TTL_SEC,
} from "@/lib/storage/objects";
import {
  CONTENT_TYPE,
  MAX_UPLOAD_MB,
  keepsakeKey,
  randomToken,
  type KeepsakeKind,
} from "@/lib/photo/keepsake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: readonly KeepsakeKind[] = ["strip", "clip"];
/** Only the two shapes this app itself produces. */
const EXTENSIONS = new Set(["png", "webm", "mp4"]);

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

  const { room, kind, extension, sizeBytes } = (body ?? {}) as Record<
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

  const signed = await presignKeepsake(key, CONTENT_TYPE[asKind]);
  if (signed === null) {
    // Configured storage is optional: without it the booth still works and
    // only the QR modes are unavailable. Say so plainly rather than failing
    // in a way that reads like a bug.
    return NextResponse.json(
      { error: "sharing by QR is not set up for this app yet" },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ...signed, expiresInSec: DOWNLOAD_URL_TTL_SEC },
    { status: 200 },
  );
}
