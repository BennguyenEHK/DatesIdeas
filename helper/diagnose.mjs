/**
 * Tries to fetch one or more links exactly the way the helper does, and says
 * how long each took and how big it was.
 *
 * This exists because "it did not work" arrives without a layer attached. The
 * browser, the tunnel, Cloudflare's edge and yt-dlp can each end a fetch, and
 * three of them report it the same way. Running this proves whether the link is
 * fetchable AT ALL on this machine, which removes the whole extractor from the
 * list of suspects in one step and leaves only the path in front of it.
 *
 * It deliberately imports extract.mjs rather than shelling out to yt-dlp, so
 * what it measures is the helper's real behaviour -- its format selector, its
 * client list and its limits -- not an approximation of them.
 *
 * Usage:
 *   node diagnose.mjs                     # the two links from the bug report
 *   node diagnose.mjs <url> [<url> ...]
 *
 * Nothing here touches the database or the tunnel: it never imports register or
 * tunnel, so running it cannot overwrite the registered helper URL.
 */
import {
  extractTrack,
  playerClients,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_DURATION_SEC,
  DEFAULT_TIMEOUT_MS,
} from './extract.mjs';

const DEFAULT_URLS = [
  'https://www.youtube.com/watch?v=lDoMJ8JqQc4',
  'https://www.youtube.com/watch?v=NLY8jn1GCA4',
];

/** The innermost message, which is the only one that says what actually failed. */
function describe(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  const stderr = typeof current?.stderr === 'string' ? current.stderr.trim() : '';
  if (stderr !== '') parts.push(stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' | '));
  return parts.join(': ');
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const urls = process.argv.slice(2);
const targets = urls.length > 0 ? urls : DEFAULT_URLS;

console.log('player clients :', playerClients());
console.log('max bytes      :', mb(DEFAULT_MAX_BYTES));
console.log('max duration   :', `${DEFAULT_MAX_DURATION_SEC}s`);
console.log('yt-dlp timeout :', `${DEFAULT_TIMEOUT_MS / 1000}s`);
console.log('');

let failures = 0;
for (const url of targets) {
  const startedAt = Date.now();
  process.stdout.write(`→ ${url}\n`);
  try {
    const track = await extractTrack(url, {});
    const elapsed = (Date.now() - startedAt) / 1000;
    console.log(`  OK       ${mb(track.media.length)} in ${elapsed.toFixed(1)}s`);
    console.log(`  title    ${track.title}`);
    console.log(`  duration ${track.durationSec}s`);
    // The first bytes say what the browser will actually be handed. A <video>
    // element shows nothing for a file whose brand says it carries only sound.
    console.log(`  brand    ${track.media.slice(8, 12).toString('latin1')}`);
    // Cloudflare's free edge gives up on an origin that takes too long, and the
    // page sees that as a failed fetch with no explanation attached.
    if (elapsed > 100) console.log('  WARNING  over 100s: Cloudflare would have ended this request first');
    else if (elapsed > 60) console.log('  WARNING  over 60s: slow enough to look broken from the page');
  } catch (error) {
    failures += 1;
    console.log(`  FAILED   after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log(`  reason   ${describe(error)}`);
  }
  console.log('');
}

console.log(failures === 0 ? 'All links fetched on this machine.' : `${failures} of ${targets.length} failed here.`);
process.exit(failures === 0 ? 0 : 1);
