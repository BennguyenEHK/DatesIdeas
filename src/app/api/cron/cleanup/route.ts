import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cronAuthorised } from "@/lib/cron/auth";
import { deleteClosedKeepsakeRows, openRoomCodes } from "@/lib/keepsakes/store";
import { albumItemCount, albumKeysInUse } from "@/lib/album/items";
import { deleteKeys, listKeys, storageConfig } from "@/lib/storage/objects";
import { runCleanup } from "@/lib/storage/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The longest a function may run on Vercel's free plan. A cleanup is a list
 *  and some deletes; it needs seconds, and this is the ceiling. */
export const maxDuration = 60;

/**
 * The daily cleanup, run by the cron in vercel.json.
 *
 * What it may delete is decided in lib/storage/cleanup.ts and nowhere else.
 * This route only checks the secret, wires the bucket and database in, and
 * reports what happened.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  // Refuse rather than run open. An unset secret must never mean "anyone may
  // delete files from the bucket".
  if (!secret) {
    return NextResponse.json({ error: "cleanup is not set up for this app yet" }, { status: 503 });
  }
  if (!cronAuthorised(request, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = storageConfig();
  if (config === null) {
    return NextResponse.json({ error: "storage is not set up for this app yet" }, { status: 503 });
  }

  // The raw client, not a wrapper that turns a failed query into an empty list:
  // for this route an empty "rooms still open" would mean deleting every open
  // room's files. A failed query must throw and stop the run.
  const sql = db();

  try {
    const report = await runCleanup({
      now: new Date(),
      listKeys: (prefix) => listKeys(prefix, config),
      deleteKeys: (keys) => deleteKeys(keys, config),
      openRoomCodes: () => openRoomCodes(sql),
      deleteClosedKeepsakeRows: () => deleteClosedKeepsakeRows(sql),
      albumKeysInUse: () => albumKeysInUse(sql),
      albumItemCount: () => albumItemCount(sql),
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "the cleanup could not finish" },
      { status: 500 },
    );
  }
}
