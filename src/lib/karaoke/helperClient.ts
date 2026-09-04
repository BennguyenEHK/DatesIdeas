export type HelperFailure =
  | "helper-unreachable"
  | "unauthorized"
  | "bad-url"
  | "not-found"
  | "extract-failed"
  | "too-large";

export interface HelperTrack {
  audio: ArrayBuffer;
  contentType: string;
  title: string;
  durationSec: number;
  lrc: string | null;
}

export type HelperResult =
  | { ok: true; track: HelperTrack }
  | { ok: false; reason: HelperFailure };

/** What went wrong, in words that suggest a next step rather than a code. */
export const HELPER_MESSAGE: Record<HelperFailure, string> = {
  "helper-unreachable": "The helper on your computer did not answer. Check it is running.",
  unauthorized: "The helper did not accept its key. Check the helper setup and try again.",
  "bad-url": "That does not look like a YouTube link. Paste a YouTube video link and try again.",
  "not-found": "That YouTube video could not be found. Check the link or choose another video.",
  "extract-failed": "The helper could not get that song. Try the link again in a moment.",
  "too-large": "That song is too large for the helper. Try a shorter video.",
};

/**
 * This convenience check saves a round trip; the helper still validates the
 * URL server-side because a browser-side check is not a security boundary.
 */
export function isYouTubeUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    if (host === "youtu.be") return path.length > 1;
    if (host !== "youtube.com" && host !== "www.youtube.com" && host !== "music.youtube.com") {
      return false;
    }

    if (path === "/watch") return parsed.searchParams.get("v") !== null && parsed.searchParams.get("v") !== "";
    return /^\/shorts\/[^/]+(?:\/)?$/.test(path);
  } catch {
    return false;
  }
}

function statusFailure(status: number): HelperFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 400) return "bad-url";
  if (status === 404) return "not-found";
  if (status === 413) return "too-large";
  return "extract-failed";
}

function decodeHeader(value: string | null): string | null {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export async function fetchTrack(
  helperUrl: string,
  token: string,
  youtubeUrl: string,
  deps?: { fetch?: typeof fetch },
): Promise<HelperResult> {
  if (!isYouTubeUrl(youtubeUrl)) return { ok: false, reason: "bad-url" };

  let endpoint: string;
  try {
    const parsed = new URL(helperUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, reason: "helper-unreachable" };
    }
    endpoint = `${helperUrl.replace(/\/+$/, "")}/extract`;
  } catch {
    return { ok: false, reason: "helper-unreachable" };
  }

  try {
    const request = deps?.fetch ?? globalThis.fetch;
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: youtubeUrl }),
    });

    const failure = statusFailure(response.status);
    if (failure !== null) return { ok: false, reason: failure };

    const audio = await response.arrayBuffer();
    if (audio.byteLength < 1024) return { ok: false, reason: "extract-failed" };

    const encodedTitle = response.headers.get("X-Track-Title");
    const title = decodeHeader(encodedTitle);
    const lrcHeader = response.headers.get("X-Track-Lrc");
    const lrc = decodeHeader(lrcHeader);
    const durationText = response.headers.get("X-Track-Duration");
    const durationSec = durationText === null ? Number.NaN : Number(durationText.trim());

    if (title === null || (lrcHeader !== null && lrc === null) || durationText?.trim() === "") {
      return { ok: false, reason: "extract-failed" };
    }
    if (!Number.isFinite(durationSec) || durationSec < 0) {
      return { ok: false, reason: "extract-failed" };
    }

    return {
      ok: true,
      track: {
        audio,
        contentType: response.headers.get("Content-Type") ?? "",
        title,
        durationSec,
        lrc,
      },
    };
  } catch {
    return { ok: false, reason: "helper-unreachable" };
  }
}
