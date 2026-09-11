import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pairFromRequest } from "@/lib/pair/session";
import { newShareId } from "@/lib/keepsakes/store";
import {
  createOccasion,
  deleteOccasion,
  listOccasions,
  updateOccasion,
} from "@/lib/album/items";

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

const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 });
const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A civil date and only that.
 *
 * An instant here would put back the timezone question an occasion exists to
 * avoid: an anniversary is a date on a wall calendar, not a moment. The
 * round-trip check is what rejects 2026-02-30, which the pattern alone is
 * perfectly happy with.
 */
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !CIVIL_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80;
}

export async function GET(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();
  return NextResponse.json({ occasions: await listOccasions(sql, pair.id) });
}

export async function POST(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("expected a json body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return bad("expected a json body");
  }

  const { title, onDate, yearly } = body as Record<string, unknown>;
  if (!validTitle(title)) return bad("an occasion needs a name");
  if (!validDate(onDate)) return bad("that is not a date");
  if (yearly !== undefined && typeof yearly !== "boolean") return bad("invalid repeat");

  const id = newShareId();
  const made = await createOccasion(sql, pair.id, {
    id,
    title: title.trim(),
    onDate,
    yearly: yearly === true,
  });
  if (!made) return NextResponse.json({ error: "could not name that day" }, { status: 503 });

  return NextResponse.json(
    {
      occasion: {
        id,
        title: title.trim(),
        onDate,
        yearly: yearly === true,
        coverItemId: null,
      },
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("expected a json body");
  }
  const patch = body as Record<string, unknown> | null;
  if (patch === null || typeof patch.id !== "string") return bad("which occasion?");
  if (patch.title !== undefined && !validTitle(patch.title)) return bad("an occasion needs a name");
  if (patch.onDate !== undefined && !validDate(patch.onDate)) return bad("that is not a date");
  if (patch.yearly !== undefined && typeof patch.yearly !== "boolean") return bad("invalid repeat");

  const changed = await updateOccasion(sql, pair.id, patch.id, {
    ...(patch.title === undefined ? {} : { title: (patch.title as string).trim() }),
    ...(patch.onDate === undefined ? {} : { onDate: patch.onDate as string }),
    ...(patch.yearly === undefined ? {} : { yearly: patch.yearly as boolean }),
  });
  return changed
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();

  const id = new URL(request.url).searchParams.get("id");
  if (id === null || id === "") return bad("which occasion?");

  // Scoped by pair like every other write: an id alone must never be enough.
  // Deleting an occasion forgets the name and nothing else -- the photographs
  // taken that day are not touched, which is the whole reason membership is
  // computed rather than stored.
  const gone = await deleteOccasion(sql, pair.id, id);
  return gone
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
