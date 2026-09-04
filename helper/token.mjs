import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The verifying half of the app's short-lived helper token.
 *
 * The browser is never given HELPER_SECRET — a room code is an unauthenticated
 * key, so anyone who saw one could read the secret out of the page and drive
 * this machine indefinitely. Instead the app mints a token that expires, signed
 * with the secret both sides hold.
 *
 * The minting half lives in src/lib/karaoke/helperToken.ts. This file is
 * duplicated on purpose: this process runs on a different machine with no
 * access to that build, and the format below is the contract between them.
 * Change one and you must change the other.
 */

const SEPARATOR = '.';

function sign(secret, expiresAtMs) {
  return createHmac('sha256', secret).update(String(expiresAtMs)).digest('hex');
}

/** True when `token` was signed by `secret` and has not expired. Never throws. */
export function verifyHelperToken(secret, token, nowMs = Date.now()) {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof token !== 'string') return false;

  const separator = token.indexOf(SEPARATOR);
  if (separator < 1) return false;

  const expiresAtMs = Number(token.slice(0, separator));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) return false;

  const supplied = Buffer.from(token.slice(separator + 1), 'utf8');
  const expected = Buffer.from(sign(secret, expiresAtMs), 'utf8');
  // timingSafeEqual throws on a length mismatch, so lengths are compared first.
  // That leaks only the length of a hex digest, which is a constant.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}
