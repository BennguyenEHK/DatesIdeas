import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveTool } from './tools.mjs';

/**
 * Where yt-dlp actually is, asked fresh each time rather than fixed at import.
 *
 * Resolving once at module load would pin whatever was true when the process
 * started, which is the same staleness this exists to escape -- and it would
 * make YTDLP_PATH impossible to correct without a restart.
 */
const ytDlp = () => resolveTool('yt-dlp');

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export const DEFAULT_MAX_DURATION_SEC = 12 * 60;
export const DEFAULT_MAX_BYTES = 30 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Which of YouTube's own front ends to impersonate when asking for the audio.
 *
 * YouTube's default `web` client now hands back format URLs that answer 403
 * Forbidden without a proof-of-origin token, while still answering metadata
 * questions perfectly -- so the failure arrives looking like a broken download
 * rather than a refused one, and the title and duration that come back first
 * make everything seem fine right up until nothing plays.
 *
 * More than one is listed because yt-dlp collects the formats every named
 * client offers and picks from the union, so a client going the way of `web`
 * costs a fallback rather than an evening.
 */
export const DEFAULT_PLAYER_CLIENTS = 'web_embedded,tv,web';

/**
 * The client list to use, overridable because YouTube breaks these on its own
 * schedule and waiting for a release to sing is worse than an env var.
 *
 * A blank override falls back rather than being passed through: an empty
 * `player_client=` is a malformed argument, not a request for the default, and
 * it would take the whole download down with it.
 */
export function playerClients(env = process.env) {
  const override = env.YTDLP_PLAYER_CLIENTS;
  if (typeof override === 'string' && override.trim() !== '') return override.trim();
  return DEFAULT_PLAYER_CLIENTS;
}

/**
 * Everything read off a video, and nothing else.
 *
 * `duration` gates the length limit, `title` names the track, and the last
 * three are what the lyrics search is built from -- `track`/`artist` when the
 * uploader filled them in, `title`/`uploader` when they did not.
 */
export const METADATA_FIELDS = ['id', 'title', 'duration', 'track', 'artist', 'uploader'];

/** The clients argument, shared so metadata and audio describe the same thing. */
function extractorArgs() {
  return ['--extractor-args', `youtube:player_client=${playerClients()}`];
}

/**
 * Asking what the video is, without fetching any of it.
 *
 * Carries the same client list as the download on purpose. The duration read
 * here decides whether a song is refused as too long, and metadata read
 * through a different client than the audio is a chance for the two to
 * disagree about what they are describing.
 */
export function buildMetadataArgs(url) {
  return [
    '--no-playlist',
    '--no-warnings',
    ...extractorArgs(),
    '--skip-download',
    // Five fields, not every format YouTube offers. The full dump for an
    // ordinary song runs past six hundred kilobytes, almost all of it format
    // descriptions nothing here reads; this returns about a hundred and fifty
    // bytes. Absent fields are simply omitted, which the readers below expect.
    '--print', `%(.{${METADATA_FIELDS.join(',')}})j`,
    '--',
    url,
  ];
}

export class ExtractError extends Error {
  constructor(kind, message, cause) {
    super(message, { cause });
    this.kind = kind;
  }
}

export function isAllowedYouTubeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;

  try {
    const parsed = new URL(value);
    // Exact host equality prevents lookalike domains from turning this into an SSRF-capable public fetcher.
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function buildYtDlpArgs(url, tmpDir, limits = {}) {
  const maxDurationSec = limits.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const outputTemplate = path.join(tmpDir, '%(id)s.%(ext)s');

  // AAC in an MP4 container plays natively in current browsers, so transcoding with ffmpeg is unnecessary.
  return [
    '--no-playlist',
    '--no-warnings',
    ...extractorArgs(),
    '--format', 'bestaudio[ext=m4a]/bestaudio',
    '--match-filter', `duration <= ${maxDurationSec}`,
    '--max-filesize', String(maxBytes),
    '--output', outputTemplate,
    '--print', 'after_move:filepath',
    '--',
    url,
  ];
}

/**
 * How much of each stream to keep, and why the two numbers differ.
 *
 * stderr is read by a human looking for what went wrong, and that sentence is
 * always at the bottom, so keeping the tail of it is right. stdout is parsed
 * as a whole, where keeping the tail is not a smaller answer but a corrupt
 * one -- and a silent one, because a truncated document fails at the parser
 * with no hint that anything was dropped.
 */
export const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
export const MAX_STDERR_BYTES = 64 * 1024;

export function run(command, args, { timeoutMs, cwd, maxStdoutBytes = MAX_STDOUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    // A crafted URL must not be able to become a command on the user's machine.
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let overflowed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (overflowed) return;
      stdout += chunk;
      // Bounded, because a runaway child must not be able to exhaust memory.
      // Said out loud rather than trimmed away: dropping part of a document
      // and returning the rest is how this failed silently for so long.
      if (stdout.length > maxStdoutBytes) {
        overflowed = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-MAX_STDERR_BYTES); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (overflowed) {
        reject(new ExtractError('failed', `yt-dlp produced too much output (over ${maxStdoutBytes} bytes)`));
      } else if (timedOut) {
        reject(new ExtractError('failed', 'yt-dlp timed out'));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new ExtractError('yt-dlp', `yt-dlp exited with ${code}`, { stdout, stderr }));
      }
    });
  });
}

function classifyYtDlpError(error) {
  const text = `${error.message}\n${error.cause?.stderr ?? ''}`.toLowerCase();
  if (text.includes('private video') || text.includes('not available') || text.includes('video unavailable')) return 'not-found';
  if (text.includes('max-filesize') || text.includes('file is larger') || text.includes('larger than')) return 'too-large';
  return 'failed';
}

async function readMetadata(url, tmpDir, timeoutMs) {
  const { stdout } = await run(ytDlp(), buildMetadataArgs(url), {
    timeoutMs,
    cwd: tmpDir,
  });
  const line = stdout.trim().split(/\r?\n/).find((entry) => entry.startsWith('{'));
  if (!line) throw new ExtractError('failed', 'yt-dlp did not return metadata');
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new ExtractError('failed', 'yt-dlp returned invalid metadata', error);
  }
}

export function chooseLyrics(results, durationSec) {
  if (!Array.isArray(results) || !Number.isFinite(durationSec)) return null;

  let closest = null;
  let closestDifference = Infinity;
  for (const result of results) {
    if (!result || typeof result.syncedLyrics !== 'string' || result.syncedLyrics.trim() === '') continue;
    const candidateDuration = Number(result.duration);
    if (!Number.isFinite(candidateDuration)) continue;
    const difference = Math.abs(candidateDuration - durationSec);
    if (difference <= 3 && difference < closestDifference) {
      closest = result.syncedLyrics;
      closestDifference = difference;
    }
  }
  return closest;
}

async function findLyrics(metadata, durationSec) {
  const trackName = typeof metadata.track === 'string' && metadata.track.trim()
    ? metadata.track : metadata.title;
  const artistName = typeof metadata.artist === 'string' && metadata.artist.trim()
    ? metadata.artist : (metadata.uploader ?? '');
  if (typeof trackName !== 'string' || trackName.trim() === '') return null;

  const params = new URLSearchParams({ track_name: trackName, artist_name: String(artistName) });
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await fetch(`https://lrclib.net/api/search?${params}`, { signal });
    if (!response.ok) return null;
    return chooseLyrics(await response.json(), durationSec);
  } catch {
    // Lyrics are optional; an outage must not stop playback.
    return null;
  }
}

async function findOutputFile(tmpDir, stdout) {
  const printedPath = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (printedPath) {
    try {
      if ((await stat(printedPath)).isFile()) return printedPath;
    } catch { /* Fall through to the temp directory scan. */ }
  }
  const entries = await readdir(tmpDir, { withFileTypes: true });
  const file = entries.find((entry) => entry.isFile() && !entry.name.endsWith('.part') && !entry.name.endsWith('.info.json'));
  return file ? path.join(tmpDir, file.name) : null;
}

export async function extractTrack(url, limits = {}) {
  const maxDurationSec = limits.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datesidea-karaoke-'));

  try {
    let metadata;
    try {
      metadata = await readMetadata(url, tmpDir, timeoutMs);
    } catch (error) {
      throw new ExtractError(classifyYtDlpError(error), 'Could not inspect the video', error);
    }
    const durationSec = Number(metadata.duration);
    if (!Number.isFinite(durationSec)) throw new ExtractError('failed', 'Video duration is unavailable');
    if (durationSec > maxDurationSec) throw new ExtractError('too-large', 'Video is too long');

    let download;
    try {
      download = await run(ytDlp(), buildYtDlpArgs(url, tmpDir, { maxDurationSec, maxBytes }), { timeoutMs, cwd: tmpDir });
    } catch (error) {
      throw new ExtractError(classifyYtDlpError(error), 'Could not download the audio', error);
    }
    const filePath = await findOutputFile(tmpDir, download.stdout);
    if (!filePath) throw new ExtractError('failed', 'yt-dlp did not create an audio file');
    const fileInfo = await stat(filePath);
    if (fileInfo.size > maxBytes) throw new ExtractError('too-large', 'Audio is too large');

    const [audio, lrc] = await Promise.all([readFile(filePath), findLyrics(metadata, durationSec)]);
    return { audio, title: String(metadata.title ?? 'YouTube track'), durationSec, lrc };
  } finally {
    // The audio is transient: always remove it, including on errors and timeouts.
    await rm(tmpDir, { recursive: true, force: true });
  }
}
