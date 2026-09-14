import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newShareId } from "@/lib/keepsakes/store";
import { isLookKeyFor, sourceKey } from "@/lib/looks/keys";
import { LOOK_SOURCE_MAX_BYTES, LOOK_SOURCE_TYPES } from "@/lib/looks/types";
import { pairFromRequest } from "@/lib/pair/session";
import { presignKeepsake } from "@/lib/storage/objects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function queryTag() {
  const client = db();
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> => {
    const rows: unknown = await client(strings, ...values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}
function extension(contentType: string): string | null {
  return contentType === "image/jpeg"
    ? "jpg"
    : contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : null;
}

export async function POST(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown> | null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (
    body === null ||
    typeof body.contentType !== "string" ||
    !LOOK_SOURCE_TYPES.includes(body.contentType as (typeof LOOK_SOURCE_TYPES)[number]) ||
    typeof body.sizeBytes !== "number" ||
    !Number.isSafeInteger(body.sizeBytes) ||
    body.sizeBytes <= 0 ||
    body.sizeBytes > LOOK_SOURCE_MAX_BYTES
  )
    return NextResponse.json(
      { error: "Use a JPEG, PNG, or WebP picture no larger than 12MB." },
      { status: 400 },
    );
  const ext = extension(body.contentType);
  if (ext === null) return NextResponse.json({ error: "Unsupported picture type." }, { status: 400 });
  const key = sourceKey(pair.id, newShareId(), ext);
  const signed = await presignKeepsake(key, body.contentType);
  if (signed === null)
    return NextResponse.json({ error: "Designed-look storage is not set up yet." }, { status: 503 });
  return NextResponse.json({ key, uploadUrl: signed.uploadUrl, url: signed.downloadUrl });
}

export async function GET(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = new URL(request.url).searchParams.get("key");
  if (key === null || !isLookKeyFor(pair.id, key))
    return NextResponse.json({ error: "Invalid source picture." }, { status: 400 });
  const signed = await presignKeepsake(
    key,
    key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg",
  );
  if (signed === null)
    return NextResponse.json({ error: "Designed-look storage is not set up yet." }, { status: 503 });
  return NextResponse.json({ key, url: signed.downloadUrl });
}
