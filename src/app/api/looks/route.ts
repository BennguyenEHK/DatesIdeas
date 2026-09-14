import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newShareId } from "@/lib/keepsakes/store";
import { backdropKey, overlayKey } from "@/lib/looks/keys";
import {
  insertLook,
  listLooks,
  lookCount,
  lookReceipt,
  looksReceiptSecret,
  receiptMatchesLook,
  toCustomLook,
} from "@/lib/looks/store";
import { isHexColor, isLookId, LOOK_LAYER_MAX_BYTES } from "@/lib/looks/types";
import { isShotCount } from "@/lib/photo/strip";
import { pairFromRequest } from "@/lib/pair/session";
import { presignKeepsake } from "@/lib/storage/objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const LOOK_CAP = 50;

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
function unavailable() {
  return NextResponse.json({ error: "Designed-look storage is not set up yet." }, { status: 503 });
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function fields(body: Record<string, unknown>): { name: string; shots: 1 | 2 | 3 | 4; ink: string } | null {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  return name.length >= 1 && name.length <= 40 && isShotCount(body.shots) && isHexColor(body.ink)
    ? { name, shots: body.shots, ink: body.ink }
    : null;
}
function layerBytes(value: unknown): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= LOOK_LAYER_MAX_BYTES
  );
}
function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}

export async function GET(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  const rows = await listLooks(sql, pair.id);
  const looks = await Promise.all(
    rows.map(async (row) => {
      const [backdrop, overlay] = await Promise.all([
        presignKeepsake(row.backdropKey, "image/png"),
        presignKeepsake(row.overlayKey, "image/png"),
      ]);
      return backdrop === null || overlay === null
        ? null
        : toCustomLook(row, backdrop.downloadUrl, overlay.downloadUrl);
    }),
  );
  const ready = looks.filter((look): look is NonNullable<typeof look> => look !== null);
  if (rows.length > 0 && ready.length === 0) return unavailable();
  return NextResponse.json({ looks: ready });
}

export async function POST(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  let body: Record<string, unknown> | null;
  try {
    body = record(await request.json());
  } catch {
    return bad("Expected a JSON body.");
  }
  if (
    body === null ||
    fields(body) === null ||
    !layerBytes(body.backdropBytes) ||
    !layerBytes(body.overlayBytes)
  ) {
    return bad("Enter a name, color, shot count, and two PNG layers no larger than 8MB.");
  }
  if ((await lookCount(sql, pair.id)) >= LOOK_CAP)
    return NextResponse.json({ error: "You can keep up to 50 designed looks." }, { status: 409 });
  const secret = looksReceiptSecret();
  if (secret === null) return unavailable();
  const id = newShareId();
  const backdrop = backdropKey(pair.id, id);
  const overlay = overlayKey(pair.id, id);
  const [backdropSigned, overlaySigned] = await Promise.all([
    presignKeepsake(backdrop, "image/png"),
    presignKeepsake(overlay, "image/png"),
  ]);
  if (backdropSigned === null || overlaySigned === null) return unavailable();
  return NextResponse.json({
    id,
    backdropKey: backdrop,
    overlayKey: overlay,
    backdropUploadUrl: backdropSigned.uploadUrl,
    overlayUploadUrl: overlaySigned.uploadUrl,
    receipt: lookReceipt(secret, pair.id, id, backdrop, overlay),
  });
}

export async function PUT(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  let body: Record<string, unknown> | null;
  try {
    body = record(await request.json());
  } catch {
    return bad("Expected a JSON body.");
  }
  const value = body === null ? null : fields(body);
  if (value === null || body === null || !isLookId(body.id)) return bad("Invalid designed look.");
  const secret = looksReceiptSecret();
  if (secret === null) return unavailable();
  const backdrop = backdropKey(pair.id, body.id);
  const overlay = overlayKey(pair.id, body.id);
  if (!receiptMatchesLook(secret, pair.id, body.id, backdrop, overlay, body.receipt))
    return bad("Invalid look receipt.");
  const stored = await insertLook(sql, {
    id: body.id,
    pairId: pair.id,
    ...value,
    backdropKey: backdrop,
    overlayKey: overlay,
  });
  if (!stored) return NextResponse.json({ error: "Could not save this look." }, { status: 409 });
  const [backdropSigned, overlaySigned] = await Promise.all([
    presignKeepsake(backdrop, "image/png"),
    presignKeepsake(overlay, "image/png"),
  ]);
  if (backdropSigned === null || overlaySigned === null) return unavailable();
  return NextResponse.json({
    look: {
      id: body.id,
      ...value,
      backdropUrl: backdropSigned.downloadUrl,
      overlayUrl: overlaySigned.downloadUrl,
      createdAt: new Date().toISOString(),
    },
  });
}
