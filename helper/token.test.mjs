import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyHelperToken } from './token.mjs';

const SECRET = 'a-shared-secret-between-app-and-helper';
const NOW = 1_700_000_000_000;

// Mirrors the app's mintHelperToken. Written out here rather than imported
// because the point of this test is that the two independent implementations
// agree — importing the app's would prove nothing.
function mint(secret, expiresAtMs) {
  const signature = createHmac('sha256', secret).update(String(expiresAtMs)).digest('hex');
  return `${expiresAtMs}.${signature}`;
}

test('accepts a live token signed with the shared secret', () => {
  assert.equal(verifyHelperToken(SECRET, mint(SECRET, NOW + 60_000), NOW), true);
});

test('rejects a token signed with another secret', () => {
  assert.equal(verifyHelperToken(SECRET, mint('other', NOW + 60_000), NOW), false);
});

test('rejects an expired token, including one expiring exactly now', () => {
  assert.equal(verifyHelperToken(SECRET, mint(SECRET, NOW - 1), NOW), false);
  assert.equal(verifyHelperToken(SECRET, mint(SECRET, NOW), NOW), false);
});

test('rejects an expiry extended without re-signing', () => {
  const token = mint(SECRET, NOW + 1_000);
  const signature = token.slice(token.indexOf('.') + 1);
  assert.equal(verifyHelperToken(SECRET, `${NOW + 999_999}.${signature}`, NOW), false);
});

test('rejects malformed tokens without throwing', () => {
  for (const token of ['', 'abcdef', '.abcdef', `${NOW + 1000}.`, 'later.abc', 'deadbeef']) {
    assert.doesNotThrow(() => verifyHelperToken(SECRET, token, NOW));
    assert.equal(verifyHelperToken(SECRET, token, NOW), false, JSON.stringify(token));
  }
});

test('rejects a missing or non-string secret and token', () => {
  assert.equal(verifyHelperToken('', mint('', NOW + 60_000), NOW), false);
  assert.equal(verifyHelperToken(SECRET, undefined, NOW), false);
  assert.equal(verifyHelperToken(undefined, 'x.y', NOW), false);
});
