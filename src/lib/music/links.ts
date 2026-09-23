import { YOUTUBE_ID_PATTERN } from "@/lib/rtc/protocol";

export type YouTubeLink =
  { kind: "video"; videoId: string } | { kind: "playlist"; listId: string };

/**
 * The playlists YouTube actually hands out: uploaded lists (PL), album releases
 * on YouTube Music (OLAK), mixes (RD), a channel's uploads (UU) and liked
 * videos (LL). Bounded so a pasted wall of text is never taken for one.
 */
const PLAYLIST_ID_PATTERN = /^(?:PL|OLAK|RD|UU|LL)[A-Za-z0-9_-]{0,62}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

function video(id: string | null | undefined): YouTubeLink | null {
  return id && YOUTUBE_ID_PATTERN.test(id)
    ? { kind: "video", videoId: id }
    : null;
}

function playlist(id: string | null): YouTubeLink | null {
  return id && PLAYLIST_ID_PATTERN.test(id)
    ? { kind: "playlist", listId: id }
    : null;
}

/**
 * Reads a song or a playlist out of whatever someone pastes.
 *
 * A link to a song inside a playlist -- `watch?v=…&list=…`, which is what the
 * Share button gives you mid-playlist -- is taken as that one song, since that
 * is the song on their screen when they copied it. Only a link to the playlist
 * page itself adds the whole list.
 *
 * Never touches the network: this answers "is this a YouTube link", not "does
 * this video exist".
 */
export function parseYouTubeLink(raw: string): YouTubeLink | null {
  const text = raw.trim();
  if (text === "") return null;

  // A link pasted without its scheme is still a link. Anything that does name
  // a scheme is parsed as written, so "javascript:" arrives as itself and is
  // refused below rather than being mistaken for a host.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const list = url.searchParams.get("list");

  if (host === "youtu.be") return video(url.pathname.slice(1).split("/")[0]);
  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (url.pathname === "/playlist") return playlist(list);
  if (url.pathname === "/watch") {
    const v = url.searchParams.get("v");
    // A watch link with no song in it, only a list, is the list.
    if (v === null) return playlist(list);
    return video(v);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["shorts", "embed", "live"].includes(parts[0])) {
    return video(parts[1]);
  }
  return null;
}
