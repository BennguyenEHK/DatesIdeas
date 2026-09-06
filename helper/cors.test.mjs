import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPOSED_HEADERS, corsHeaders } from './cors.mjs';

const APP = 'https://datesideas.vercel.app';

test('THE BUG: the track headers are exposed, or the browser cannot read them', () => {
  // Everything about this request succeeded -- three megabytes of audio
  // arrived -- and the page still reported that the song could not be
  // fetched, because a browser hides every custom response header from
  // fetch() unless the server names it here. curl obeys no such rule, which
  // is why this survived every test run from a terminal.
  const headers = corsHeaders(APP, APP);
  assert.ok(headers, 'the app origin must be allowed');
  const exposed = headers['Access-Control-Expose-Headers'];
  assert.ok(exposed, 'no Access-Control-Expose-Headers at all');
  for (const name of ['X-Track-Title', 'X-Track-Duration', 'X-Track-Lrc']) {
    assert.ok(exposed.includes(name), `${name} is unreadable in a browser`);
  }
});

test('every header the client reads is in the exposed list', () => {
  // src/lib/karaoke/helperClient.ts reads exactly these three, and treats a
  // missing title or duration as a failed extraction. Adding a fourth reader
  // there without adding it here would fail the same silent way.
  assert.deepEqual(
    [...EXPOSED_HEADERS].sort(),
    ['X-Track-Duration', 'X-Track-Lrc', 'X-Track-Title'],
  );
});

test('an origin that is not the app gets nothing', () => {
  // This server is reachable from the public internet through a tunnel, so a
  // permissive answer would let any website drive a visitor's browser into
  // fetching through this machine.
  assert.equal(corsHeaders('https://evil.test', APP), null);
  assert.equal(corsHeaders(undefined, APP), null);
  assert.equal(corsHeaders(`${APP}.evil.test`, APP), null);
});

test('no allowed origin configured means no cross-origin access', () => {
  assert.equal(corsHeaders(APP, undefined), null);
  assert.equal(corsHeaders(APP, ''), null);
});

test('the answer varies by origin, so a cache cannot cross the two', () => {
  assert.equal(corsHeaders(APP, APP).Vary, 'Origin');
});

test('the allowed methods and request headers are unchanged', () => {
  const headers = corsHeaders(APP, APP);
  assert.equal(headers['Access-Control-Allow-Origin'], APP);
  assert.equal(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assert.equal(headers['Access-Control-Allow-Headers'], 'Authorization, Content-Type');
});
