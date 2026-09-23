import { NextResponse } from "next/server";
import { YOUTUBE_ID_PATTERN } from "@/lib/rtc/protocol";

export const runtime = "nodejs";

/** Long enough for a slow answer, short enough that a hung one frees the bar. */
const UPSTREAM_TIMEOUT_MS = 5000;

/**
 * A song's title and channel, looked up from YouTube's public oEmbed endpoint.
 *
 * Asked here rather than from the browser because YouTube's oEmbed answers
 * without CORS headers, so a page cannot read it directly. It needs no key.
 * Only a validated video id is ever put into the upstream URL, so this cannot
 * be pointed at anything but a YouTube watch page.
 *
 * A day of caching, because a video's title almost never changes and both
 * screens ask for the same ids within seconds of each other.
 */
export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get("videoId");
  if (videoId === null || !YOUTUBE_ID_PATTERN.test(videoId)) {
    return NextResponse.json({ error: "invalid video id" }, { status: 400 });
  }

  const watch = `https://www.youtube.com/watch?v=${videoId}`;
  const upstream = `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(upstream, { signal: controller.signal });
    if (res.status === 404) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: "upstream error" }, { status: 502 });
    }

    const body = (await res.json()) as Record<string, unknown>;
    if (
      typeof body.title !== "string" ||
      typeof body.author_name !== "string"
    ) {
      return NextResponse.json({ error: "upstream error" }, { status: 502 });
    }
    return NextResponse.json(
      { title: body.title, author: body.author_name },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=86400" },
      },
    );
  } catch {
    // Unreachable, timed out, or answered with something that was not JSON.
    return NextResponse.json(
      { error: "upstream unreachable" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
