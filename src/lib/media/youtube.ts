/**
 * Pulls the video id out of whatever a person actually pastes.
 *
 * Handles the share link, the address-bar link, the embed link, and any of
 * them carrying a playlist, timestamp or tracking parameters — because the
 * link someone copies mid-evening is never the tidy one.
 */
export function youTubeId(input: string): string | null {
  const raw = input.trim();
  if (raw === "") return null;

  // A bare id, which is what you get from pasting twice.
  if (/^[\w-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  const valid = (id: string | null | undefined) =>
    id && /^[\w-]{11}$/.test(id) ? id : null;

  if (host === "youtu.be") return valid(url.pathname.slice(1).split("/")[0]);

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return valid(url.searchParams.get("v"));
    const parts = url.pathname.split("/").filter(Boolean);
    // /embed/ID, /v/ID, /shorts/ID, /live/ID
    if (["embed", "v", "shorts", "live"].includes(parts[0])) return valid(parts[1]);
  }

  return null;
}

/** Seconds offset from a link that carries one, e.g. ?t=90 or #t=1m30s. */
export function youTubeStart(input: string): number {
  const match = /[?&#]t=([\dhms]+)/i.exec(input);
  if (!match) return 0;
  const value = match[1];
  if (/^\d+$/.test(value)) return Number(value);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
  if (!parts) return 0;
  const [, h, m, s] = parts;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}
