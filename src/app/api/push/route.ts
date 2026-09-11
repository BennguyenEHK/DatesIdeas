import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pairFromRequest } from "@/lib/pair/session";
import { forgetDevice, isPushEndpoint, rememberDevice } from "@/lib/push/devices";
import { vapidConfig } from "@/lib/push/send";

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

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * The public key a browser needs in order to subscribe at all.
 *
 * Served from a route rather than compiled in with a NEXT_PUBLIC_ prefix. The
 * value genuinely is public, so this is not about secrecy -- it is so that the
 * app has exactly one place where "is push configured?" is answered, and a
 * deployment without keys reports that plainly instead of shipping a bundle
 * that subscribes to nothing.
 */
export async function GET() {
  const config = vapidConfig();
  if (config === null) {
    return NextResponse.json({ available: false, publicKey: null });
  }
  return NextResponse.json({ available: true, publicKey: config.publicKey });
}

/** Records this browser as somewhere the pair's snaps should be delivered. */
export async function POST(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a json body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "expected a json body" }, { status: 400 });
  }

  const { endpoint, p256dh, auth, label } = body as Record<string, unknown>;
  if (!isPushEndpoint(endpoint)) {
    return NextResponse.json({ error: "invalid endpoint" }, { status: 400 });
  }
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh === "" || auth === "") {
    return NextResponse.json({ error: "invalid subscription keys" }, { status: 400 });
  }
  if (label !== undefined && label !== null && typeof label !== "string") {
    return NextResponse.json({ error: "invalid label" }, { status: 400 });
  }

  const deviceId = await rememberDevice(sql, pair.id, {
    endpoint,
    p256dh,
    auth,
    label: typeof label === "string" ? label.slice(0, 60) : null,
  });
  if (deviceId === null) {
    return NextResponse.json({ error: "could not record this device" }, { status: 503 });
  }

  // The id comes back so the browser can name itself when it uploads, and be
  // left out of the push it caused. A phone that buzzes to tell you about the
  // photograph you just took on it is worse than no notification at all.
  return NextResponse.json({ deviceId });
}

/** Turning notifications off on this device. */
export async function DELETE(request: Request) {
  const sql = queryTag();
  const pair = await pairFromRequest(sql, request);
  if (pair === null) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a json body" }, { status: 400 });
  }
  const endpoint = (body as Record<string, unknown> | null)?.endpoint;
  if (!isPushEndpoint(endpoint)) {
    return NextResponse.json({ error: "invalid endpoint" }, { status: 400 });
  }

  // Scoped by pair, like every album write: an endpoint alone must never be
  // enough to unsubscribe somebody else's phone.
  const forgotten = await forgetDevice(sql, pair.id, endpoint);
  return forgotten
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
