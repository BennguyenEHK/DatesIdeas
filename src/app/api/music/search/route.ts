import { NextResponse } from "next/server";
import { youtubeApiKey } from "@/lib/env";
import { YOUTUBE_ID_PATTERN } from "@/lib/rtc/protocol";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 5000;
const CACHE_CONTROL = "public, max-age=3600";

/**
 * YouTube escapes titles as HTML. The ampersand goes last: decoded first, an
 * escaped "&amp;lt;" would turn into "<" rather than the "&lt;" it spells.
 */
function decodeHtml(text: string): string {
  return text
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&lt;|&#60;|&#x3c;/gi, "<")
    .replace(/&gt;|&#62;|&#x3e;/gi, ">")
    .replace(/&(?:amp|#38);|&#x26;/gi, "&");
}

function unavailable() {
  return NextResponse.json(
    { error: "search unavailable" },
    { status: 503 },
  );
}

/**
 * Songs matching some words, from the YouTube Data API.
 *
 * Asked here so the key never reaches a page. Only embeddable videos are
 * asked for, since anything else would show YouTube's error card in the bar.
 * No key, or a key out of quota, answers 503 so the bar can say search is not
 * available and point at pasting a link instead.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 1 || query.length > 100) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  const key = youtubeApiKey();
  if (key === null) return unavailable();

  const upstreamUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  upstreamUrl.searchParams.set("part", "snippet");
  upstreamUrl.searchParams.set("type", "video");
  upstreamUrl.searchParams.set("videoEmbeddable", "true");
  upstreamUrl.searchParams.set("maxResults", "8");
  upstreamUrl.searchParams.set("q", query);
  upstreamUrl.searchParams.set("key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(upstreamUrl, { signal: controller.signal });
    if (response.status === 403 || response.status === 429) return unavailable();
    if (!response.ok) {
      return NextResponse.json({ error: "upstream error" }, { status: 502 });
    }

    const body = (await response.json()) as {
      items?: Array<{
        id?: { videoId?: unknown };
        snippet?: {
          title?: unknown;
          channelTitle?: unknown;
          thumbnails?: { default?: { url?: unknown } };
        };
      }>;
    };
    const results = (body.items ?? []).flatMap((item) => {
      const videoId = item.id?.videoId;
      const snippet = item.snippet;
      if (
        typeof videoId !== "string" ||
        !YOUTUBE_ID_PATTERN.test(videoId) ||
        typeof snippet?.title !== "string" ||
        typeof snippet.channelTitle !== "string"
      ) return [];
      const thumbnail = snippet.thumbnails?.default?.url;
      return [{
        videoId,
        title: decodeHtml(snippet.title),
        channel: decodeHtml(snippet.channelTitle),
        thumbnail: typeof thumbnail === "string" ? thumbnail : null,
      }];
    });

    return NextResponse.json(
      { results },
      { status: 200, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch {
    return NextResponse.json({ error: "upstream unreachable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
