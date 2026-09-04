import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
    '--format', 'bestaudio[ext=m4a]/bestaudio',
    '--match-filter', `duration <= ${maxDurationSec}`,
    '--max-filesize', String(maxBytes),
    '--output', outputTemplate,
    '--print', 'after_move:filepath',
    '--',
    url,
  ];
}

function run(command, args, { timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    // A crafted URL must not be able to become a command on the user's machine.
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-64 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-64 * 1024); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
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
  const { stdout } = await run('yt-dlp', ['--no-playlist', '--no-warnings', '--dump-single-json', '--skip-download', '--', url], {
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
      download = await run('yt-dlp', buildYtDlpArgs(url, tmpDir, { maxDurationSec, maxBytes }), { timeoutMs, cwd: tmpDir });
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
