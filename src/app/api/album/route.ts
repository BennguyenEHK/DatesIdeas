import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { newShareId } from "@/lib/keepsakes/store";
import { randomToken } from "@/lib/photo/keepsake";
import { pairFromRequest } from "@/lib/pair/session";
import { linkRoomToPair } from "@/lib/pair/store";
import { isValidRoomCode } from "@/lib/room/code";
import { insertItem, listItems, listOccasions, type AlbumItemRow } from "@/lib/album/items";
import { albumExtension, albumKey, allowsContentType, isAlbumKey, needsPoster, posterKeyFor, POSTER_CONTENT_TYPE, withinCap } from "@/lib/album/keys";
import { isAlbumKind, type AlbumItem, type AlbumKind } from "@/lib/album/types";
import { clampHappenedAt, type PresignResponse } from "@/lib/album/wire";
import { presignKeepsake } from "@/lib/storage/objects";
import { utcOffsetMinutes } from "@/lib/storage/datedName";
import { receiptMatches, receiptSecret, uploadReceipt } from "@/lib/album/receipt";
import { devicesToNotify } from "@/lib/push/devices";
import { sendToDevices, SNAP_PUSH_TTL_SEC } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function unauthorized() { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
function unavailable() {
  return NextResponse.json({ error: "sharing by QR is not set up for this app yet" }, { status: 503 });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function uploadFields(body: Record<string, unknown>): { kind: AlbumKind; contentType: string; sizeBytes: number } | null {
  if (!isAlbumKind(body.kind) || typeof body.contentType !== "string" || typeof body.sizeBytes !== "number") return null;
  return allowsContentType(body.kind, body.contentType) && withinCap(body.kind, body.sizeBytes)
    ? { kind: body.kind, contentType: body.contentType, sizeBytes: body.sizeBytes } : null;
}

function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  };
}

async function itemForClient(row: AlbumItemRow): Promise<AlbumItem | null> {
  const [object, poster] = await Promise.all([
    presignKeepsake(row.objectKey, row.contentType),
    row.posterKey === null ? Promise.resolve(null) : presignKeepsake(row.posterKey, POSTER_CONTENT_TYPE),
  ]);
  if (object === null || (row.posterKey !== null && poster === null)) return null;
  return { id: row.id, kind: row.kind, contentType: row.contentType, bytes: row.bytes,
    happenedAt: row.happenedAt, createdAt: row.createdAt, caption: row.caption, loved: row.loved,
    sourceRoom: row.sourceRoom, url: object.downloadUrl, posterUrl: poster?.downloadUrl ?? null };
}

export async function POST(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  let body: Record<string, unknown> | null;
  try { body = record(await request.json()); } catch { return bad("expected a json body"); }
  if (body === null) return bad("expected a json body");
  const fields = uploadFields(body);
  if (fields === null) return bad("invalid upload");
  if (body.withPoster !== undefined && typeof body.withPoster !== "boolean") return bad("invalid poster request");
  if (body.sourceRoom !== undefined && body.sourceRoom !== null && typeof body.sourceRoom !== "string") return bad("invalid source room");
  const extension = albumExtension(fields.contentType);
  if (extension === null) return bad("invalid content type");
  const happenedAt = clampHappenedAt(body.happenedAt);
  const secret = receiptSecret();
  if (secret === null) return unavailable();
  // Four random bytes, not eight: the name is read by people now, and four
  // bytes is already one in four billion for two files sharing a second.
  const objectKey = albumKey(happenedAt, utcOffsetMinutes(body.utcOffsetMinutes), fields.kind, extension, randomToken(4));
  const signed = await presignKeepsake(objectKey, fields.contentType);
  if (signed === null) return unavailable();
  // Typed as the shared contract rather than an inline shape, so a change to
  // wire.ts that this route has not followed fails the build instead of
  // quietly serving a client something it cannot parse.
  const response: PresignResponse = {
    id: newShareId(), uploadUrl: signed.uploadUrl, happenedAt, objectKey,
    receipt: uploadReceipt(secret, pair.id, objectKey), kind: fields.kind,
  };
  if (body.withPoster === true && needsPoster(fields.kind)) {
    const poster = await presignKeepsake(posterKeyFor(objectKey), POSTER_CONTENT_TYPE);
    if (poster === null) return unavailable();
    response.posterUploadUrl = poster.uploadUrl;
  }
  return NextResponse.json(response);
}

export async function PUT(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  let body: Record<string, unknown> | null;
  try { body = record(await request.json()); } catch { return bad("expected a json body"); }
  if (body === null || typeof body.id !== "string" || body.id.length === 0 || typeof body.objectKey !== "string") return bad("invalid confirmation");
  const fields = uploadFields(body);
  if (fields === null) return bad("invalid upload");
  if ((body.sourceRoom !== undefined && body.sourceRoom !== null && typeof body.sourceRoom !== "string") ||
    (body.posterUploaded !== undefined && typeof body.posterUploaded !== "boolean")) return bad("invalid confirmation");
  const room = typeof body.sourceRoom === "string" ? body.sourceRoom : null;
  // A valid album key alone is not enough: another pair's file must never be
  // turned into a row this pair can later sign and read. The path no longer
  // names the pair, so the receipt issued with the key is what proves it.
  const secret = receiptSecret();
  if (secret === null) return unavailable();
  if (!isAlbumKey(body.objectKey) || !receiptMatches(secret, pair.id, body.objectKey, body.receipt)) {
    return bad("invalid object key");
  }
  const happenedAt = clampHappenedAt(body.happenedAt);
  const posterKey = body.posterUploaded === true && needsPoster(fields.kind) ? posterKeyFor(body.objectKey) : null;
  const stored = await insertItem(sql, { id: body.id, pairId: pair.id, objectKey: body.objectKey,
    posterKey, kind: fields.kind, contentType: fields.contentType, bytes: fields.sizeBytes,
    happenedAt, sourceRoom: room });
  if (!stored) return NextResponse.json({ error: "could not confirm upload" }, { status: 409 });

  // Record that this evening belonged to this pair, now that it has produced
  // something worth keeping. Best effort on purpose: the photograph is saved
  // either way, and the room may have closed between the shutter and the save.
  // It also refuses to take a room another pair already claimed.
  if (room !== null && isValidRoomCode(room)) {
    await linkRoomToPair(sql, room.toUpperCase(), pair.id);
  }
  const item = await itemForClient({ id: body.id, pairId: pair.id, objectKey: body.objectKey, posterKey,
    kind: fields.kind, contentType: fields.contentType, bytes: fields.sizeBytes, happenedAt,
    createdAt: new Date().toISOString(), caption: null, loved: false, sourceRoom: room,
    // Never paged from; this row is echoed straight back to the uploader.
    cursor: "" });
  if (item === null) return unavailable();

  /*
   * Ring the other phone, after the reply has already gone.
   *
   * `after` rather than an awaited call, and rather than a fire-and-forget
   * promise: the upload is finished and the person is waiting on nothing, but
   * a bare floating promise on a serverless function is killed the moment the
   * response is flushed, so half the pushes would simply never be sent.
   *
   * Everything in here is allowed to fail quietly. The photograph is already
   * saved; a notification that does not arrive is a smaller loss than an
   * upload that reports failure because a push service was having a bad day.
   */
  const senderDevice = request.headers.get("x-device-id");
  after(async () => {
    try {
      const devices = await devicesToNotify(sql, pair.id, senderDevice);
      if (devices.length === 0) return;

      // Signed for as long as the push may sit undelivered. The ten minutes a
      // page view gets would expire long before a phone that was switched off
      // came back to look at it.
      const picture = await presignKeepsake(
        posterKey ?? body.objectKey as string,
        posterKey === null ? fields.contentType : POSTER_CONTENT_TYPE,
        undefined,
        SNAP_PUSH_TTL_SEC,
      );

      await sendToDevices(sql, devices, {
        title: fields.kind === "video" || fields.kind === "recording" ? "A video note" : "A new snap",
        body: "Tap to see it on the reel.",
        image: picture?.downloadUrl ?? null,
        url: "/album",
        // One tag for all of them, so five snaps while a phone was in a
        // pocket arrive as one line rather than as five.
        tag: "festibooth-snap",
      });
    } catch {
      // Nobody left to tell. An exception here would surface only as an
      // unhandled rejection in a log nobody reads.
    }
  });

  return NextResponse.json({ item });
}

export async function GET(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  const since = new URL(request.url).searchParams.get("since");
  if (since !== null && !Number.isFinite(Date.parse(since))) return bad("invalid cursor");
  const [rows, occasions] = await Promise.all([listItems(sql, pair.id, since), listOccasions(sql, pair.id)]);
  const signed = await Promise.all(rows.map(itemForClient));
  const items = signed.filter((item): item is AlbumItem => item !== null);
  // One item that will not sign must not take the album down with it. An
  // album of four hundred memories that refuses to open because of a single
  // broken row is a far worse outcome than one that quietly shows 399 -- and
  // the missing one is recoverable, whereas a person who cannot open the page
  // at all has no way to find that out. Total failure still reports itself,
  // because that is storage being unreachable rather than one bad row.
  if (rows.length > 0 && items.length === 0) return unavailable();
  // Paged on row.cursor, not row.createdAt. The two differ by microseconds and
  // that difference is the whole thing: see AlbumItemRow.cursor. Both are
  // Postgres-formatted UTC to the same width, so a string compare orders them.
  const cursor = rows.reduce<string | null>(
    (newest, item) => (newest === null || item.cursor > newest ? item.cursor : newest),
    null,
  );
  return NextResponse.json({ items, occasions, cursor });
}
