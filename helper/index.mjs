import { createServer } from 'node:http';
import { extractTrack, ExtractError, isAllowedYouTubeUrl } from './extract.mjs';
import { startRegistration } from './register.mjs';
import { verifyHelperToken } from './token.mjs';
import { startTunnel } from './tunnel.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const VERSION = '1.0.0';
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Callers present a short-lived token minted by the app, never the secret
 * itself.
 *
 * The secret would otherwise have to reach the browser to be sent from it, and
 * a room code is an unauthenticated key — so anyone who saw one could read the
 * secret out of the page and drive this machine for as long as it went
 * unchanged. A token expires in minutes and is worth correspondingly little.
 */
function hasValidBearerToken(request) {
  const secret = process.env.HELPER_SECRET;
  const header = request.headers.authorization;
  if (!secret || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return verifyHelperToken(secret, header.slice(7));
}

function applyCors(request, response) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && request.headers.origin === allowedOrigin) {
    // Restrict browser access so an arbitrary website cannot drive this public tunnel from a visitor's browser.
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Vary', 'Origin');
    return true;
  }
  return false;
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new Error('body-too-large');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    if (!applyCors(request, response)) return sendJson(response, 403, { error: 'cors forbidden' });
    response.writeHead(204);
    return response.end();
  }

  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { ok: true, version: VERSION });
  }
  if (request.method !== 'POST' || request.url !== '/extract') return sendJson(response, 404, { error: 'not found' });

  // Authenticate before parsing hostile request bytes or invoking any extractor work.
  if (!hasValidBearerToken(request)) return sendJson(response, 401, { error: 'unauthorized' });
  applyCors(request, response);

  let body;
  try {
    body = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: 'bad-url' });
  }
  if (!body || typeof body.url !== 'string') return sendJson(response, 400, { error: 'bad-url' });
  if (!isAllowedYouTubeUrl(body.url)) return sendJson(response, 400, { error: 'bad-url' });

  try {
    const track = await extractTrack(body.url, {
      maxDurationSec: Number(process.env.MAX_DURATION_SEC) || undefined,
      maxBytes: Number(process.env.MAX_BYTES) || undefined,
      timeoutMs: Number(process.env.TIMEOUT_MS) || undefined,
    });
    const headers = {
      'Content-Type': 'audio/mp4',
      'Content-Length': String(track.audio.length),
      'X-Track-Title': encodeURIComponent(track.title),
      'X-Track-Duration': String(track.durationSec),
    };
    if (track.lrc) headers['X-Track-Lrc'] = encodeURIComponent(track.lrc);
    response.writeHead(200, headers);
    response.end(track.audio);
  } catch (error) {
    const status = error instanceof ExtractError && error.kind === 'not-found' ? 404
      : error instanceof ExtractError && error.kind === 'too-large' ? 413 : 500;
    return sendJson(response, status, { error: status === 404 ? 'not found/private' : status === 413 ? 'too large' : 'extract failed' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Karaoke helper listening on http://127.0.0.1:${PORT}`);

  // A hostname given explicitly is a named tunnel and never changes, so it is
  // simply used. Otherwise cloudflared is started here and asked what address
  // it was given, because a quick tunnel's hostname is new on every boot and
  // one written down by hand is stale by the next one.
  if (process.env.TUNNEL_URL) {
    startRegistration();
    return;
  }

  startTunnel({
    port: PORT,
    onUrl: (url) => {
      process.env.TUNNEL_URL = url;
      startRegistration();
    },
  });
});
