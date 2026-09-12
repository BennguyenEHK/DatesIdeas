import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pairFromRequest } from "@/lib/pair/session";
import { newShareId } from "@/lib/keepsakes/store";
import {
  deleteBlock,
  insertBlock,
  listBlocks,
  updateBlock,
  type BlockPatch,
} from "@/lib/calendar/blocks";
import { isRepeat } from "@/lib/calendar/recur";

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

/** How far ahead a single request may ask for. A year of a daily repeat is
 *  already four hundred occurrences, which is the expansion cap. */
const MAX_WINDOW_DAYS = 400;

function validInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * An IANA zone, checked by asking Intl whether it will accept it.
 *
 * There is no list to compare against and inventing one would go stale. The
 * zone is stored and later used to expand recurrence, so a value Intl refuses
 * would turn every future occurrence of that block into an exception.
 */
function validZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120;
}

function validReminder(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10080)
  );
}

export async function GET(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();

  const params = new URL(request.url).searchParams;
  const until = params.get("until");
  if (until !== null && !validInstant(until)) return bad("invalid window");

  const ceiling = new Date(Date.now() + MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const asked = until === null ? ceiling : new Date(until);
  const end = asked > ceiling ? ceiling : asked;

  // The rows, not the occurrences. Expanding repeats is `recur.ts`'s job and it
  // runs in the browser, where the viewer's own timezone already lives -- the
  // server has no way to know which of the two people is asking.
  return NextResponse.json({ blocks: await listBlocks(sql, pair.id, end.toISOString()) });
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

  const b = body as Record<string, unknown>;
  if (!validTitle(b.title)) return bad("this needs a name");
  if (!validInstant(b.startsAt) || !validInstant(b.endsAt)) return bad("invalid times");
  if (Date.parse(b.endsAt as string) <= Date.parse(b.startsAt as string)) {
    return bad("it has to end after it starts");
  }
  if (!validZone(b.zone)) return bad("invalid timezone");
  if (b.repeat !== undefined && !isRepeat(b.repeat)) return bad("invalid repeat");
  if (b.repeatUntil !== undefined && b.repeatUntil !== null && !validCivilDate(b.repeatUntil)) {
    return bad("invalid repeat end");
  }
  if (!validReminder(b.remindMinutes)) return bad("invalid reminder");
  if (b.owner !== undefined && (typeof b.owner !== "string" || b.owner.length > 40)) {
    return bad("invalid owner");
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") {
    return bad("invalid note");
  }

  const id = newShareId();
  const made = await insertBlock(sql, pair.id, {
    id,
    title: (b.title as string).trim(),
    note: typeof b.note === "string" ? b.note.slice(0, 500) : null,
    startsAt: new Date(b.startsAt as string).toISOString(),
    endsAt: new Date(b.endsAt as string).toISOString(),
    zone: b.zone as string,
    owner: typeof b.owner === "string" && b.owner !== "" ? b.owner : "both",
    repeat: isRepeat(b.repeat) ? b.repeat : "none",
    repeatUntil: validCivilDate(b.repeatUntil) ? b.repeatUntil : null,
    remindMinutes: typeof b.remindMinutes === "number" ? b.remindMinutes : null,
  });
  if (!made) return NextResponse.json({ error: "could not save that" }, { status: 503 });

  return NextResponse.json({ id }, { status: 201 });
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
  const b = body as Record<string, unknown> | null;
  if (b === null || typeof b.id !== "string") return bad("which block?");

  const patch: BlockPatch = {};
  if (b.title !== undefined) {
    if (!validTitle(b.title)) return bad("this needs a name");
    patch.title = (b.title as string).trim();
  }
  if (b.note !== undefined) {
    if (b.note !== null && typeof b.note !== "string") return bad("invalid note");
    patch.note = typeof b.note === "string" ? b.note.slice(0, 500) : null;
  }
  if (b.startsAt !== undefined) {
    if (!validInstant(b.startsAt)) return bad("invalid times");
    patch.startsAt = new Date(b.startsAt).toISOString();
  }
  if (b.endsAt !== undefined) {
    if (!validInstant(b.endsAt)) return bad("invalid times");
    patch.endsAt = new Date(b.endsAt).toISOString();
  }
  if (patch.startsAt !== undefined && patch.endsAt !== undefined) {
    if (Date.parse(patch.endsAt) <= Date.parse(patch.startsAt)) {
      return bad("it has to end after it starts");
    }
  }
  if (b.owner !== undefined) {
    if (typeof b.owner !== "string" || b.owner.length > 40) return bad("invalid owner");
    patch.owner = b.owner === "" ? "both" : b.owner;
  }
  if (b.repeat !== undefined) {
    if (!isRepeat(b.repeat)) return bad("invalid repeat");
    patch.repeat = b.repeat;
  }
  if (b.repeatUntil !== undefined) {
    if (b.repeatUntil !== null && !validCivilDate(b.repeatUntil)) return bad("invalid repeat end");
    patch.repeatUntil = (b.repeatUntil as string | null) ?? null;
  }
  if (b.remindMinutes !== undefined) {
    if (!validReminder(b.remindMinutes)) return bad("invalid reminder");
    patch.remindMinutes = (b.remindMinutes as number | null) ?? null;
  }

  const changed = await updateBlock(sql, pair.id, b.id, patch);
  return changed
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();

  const id = new URL(request.url).searchParams.get("id");
  if (id === null || id === "") return bad("which block?");

  const gone = await deleteBlock(sql, pair.id, id);
  return gone
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
