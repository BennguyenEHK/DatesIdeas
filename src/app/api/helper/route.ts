import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { helperSecret } from "@/lib/env";
import { mintHelperToken, TOKEN_LIFETIME_MS } from "@/lib/karaoke/helperToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function hasHelperSecret(authorization: string | null, secret: string): boolean {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(token);
  const length = Math.max(expected.length, supplied.length);
  const expectedPadded = Buffer.alloc(length);
  const suppliedPadded = Buffer.alloc(length);

  expected.copy(expectedPadded);
  supplied.copy(suppliedPadded);

  // A registrant can point the room at a machine they control, so compare the
  // token in constant time. Both padded buffers are compared even when their
  // original lengths differ, rather than rejecting a length mismatch early.
  const matches = timingSafeEqual(expectedPadded, suppliedPadded);
  return expected.length === supplied.length && matches;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Where the helper is, and a short-lived pass to use it.
 *
 * The token is minted here rather than the secret being sent, so a browser can
 * reach the helper for the next few minutes and never learns the credential
 * behind it. Returning `null` for both is a normal state — the helper has
 * simply never registered — not an error.
 */
export async function GET() {
  const sql = db();
  const rows = (await sql`
    SELECT url FROM helper_endpoint WHERE id = 1
  `) as { url: string }[];

  const url = rows[0]?.url ?? null;
  if (url === null) {
    return NextResponse.json({ url: null, token: null }, { status: 200 });
  }

  // Only minted once there is somewhere to use it, so an unconfigured room
  // never hands out a signature at all.
  const token = mintHelperToken(helperSecret(), Date.now() + TOKEN_LIFETIME_MS);
  return NextResponse.json({ url, token }, { status: 200 });
}

export async function PUT(request: Request) {
  if (!hasHelperSecret(request.headers.get("authorization"), helperSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("expected a json body");
  }

  const { url } = (body ?? {}) as Record<string, unknown>;
  if (typeof url !== "string" || !isHttpsUrl(url)) {
    // The browser page is HTTPS, so an HTTP helper URL would be blocked before
    // it could work. Saving one here would only preserve a broken endpoint.
    return bad("invalid helper url");
  }

  const sql = db();
  await sql`
    INSERT INTO helper_endpoint (id, url)
    VALUES (1, ${url})
    ON CONFLICT (id) DO UPDATE
    SET url = excluded.url, updated_at = now()
  `;

  return NextResponse.json({ ok: true }, { status: 200 });
}
