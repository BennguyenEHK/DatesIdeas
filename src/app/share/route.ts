import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The share target's fallback.
 *
 * Android POSTs here when somebody shares a photo to FestiBooth. Almost always
 * the service worker intercepts it first and this is never reached -- but the
 * worker can be missing on the very first launch after install, or after a
 * browser has evicted it, and without this the share would land on a 405 and
 * the person would simply conclude the app is broken.
 *
 * The files cannot be rescued here: a route handler on Vercel refuses bodies
 * over about four and a half megabytes, which is most photographs and every
 * video. So this says what happened and sends them somewhere they can act.
 */
export async function POST(request: Request) {
  return NextResponse.redirect(new URL("/album?shared=failed", request.url), 303);
}

/** Somebody following the URL by hand, or a share arriving as a GET. */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/album", request.url), 302);
}
