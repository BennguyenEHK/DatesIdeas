export const MAX_DURATION_DRIFT_SEC = 3;

export interface LyricsQuery {
  title: string;
  artist?: string | null;
  durationSec: number;
}

interface LyricsEntry {
  duration: number;
  syncedLyrics: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function lyricsEntry(value: unknown): LyricsEntry | null {
  if (!isRecord(value)) return null;

  const duration = value.duration;
  const syncedLyrics = value.syncedLyrics;
  if (typeof duration !== "number" || !Number.isFinite(duration)) return null;
  if (typeof syncedLyrics !== "string" || syncedLyrics.trim().length === 0) return null;

  return { duration, syncedLyrics };
}

export function searchUrl(query: LyricsQuery): string {
  const params = new URLSearchParams({ track_name: query.title });
  if (query.artist !== null && query.artist !== undefined && query.artist.trim() !== "") {
    params.set("artist_name", query.artist);
  }
  return `https://lrclib.net/api/search?${params.toString()}`;
}

export function chooseBest(results: unknown, durationSec: number): string | null {
  if (!Array.isArray(results) || !Number.isFinite(durationSec)) return null;

  let best: LyricsEntry | null = null;
  let bestDrift = Infinity;
  for (const result of results) {
    const candidate = lyricsEntry(result);
    if (candidate === null) continue;

    const drift = Math.abs(candidate.duration - durationSec);
    if (drift < bestDrift) {
      best = candidate;
      bestDrift = drift;
    }
  }

  // A larger mismatch means timestamps would drift through the track, so no lyrics are safer.
  return best !== null && bestDrift <= MAX_DURATION_DRIFT_SEC ? best.syncedLyrics : null;
}

export async function findLyrics(
  query: LyricsQuery,
  deps?: { fetch?: typeof fetch },
): Promise<string | null> {
  try {
    const response = await (deps?.fetch ?? globalThis.fetch)(searchUrl(query));
    if (!response.ok) return null;
    const results: unknown = await response.json();
    // Finding no lyrics is a normal outcome, not an error; the song still plays.
    return chooseBest(results, query.durationSec);
  } catch {
    return null;
  }
}
