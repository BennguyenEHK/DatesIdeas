import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived proof that the app authorised this browser to use the helper.
 *
 * The helper sits behind a public tunnel on someone's home machine, so it has
 * to authenticate its callers. The obvious approach — hand the shared secret to
 * the browser — would be a mistake here: a room code is an unauthenticated key
 * (see migration 0004), so anyone who ever sees one could read the secret out
 * of the page and drive that machine for as long as it stays unchanged.
 *
 * So the browser never receives the secret. It receives a token that expires,
 * signed with the secret, which the helper can verify because it holds the same
 * secret. A leaked token buys a few minutes; a leaked secret buys everything.
 *
 * The verifying half of this lives in helper/token.mjs. The duplication is
 * deliberate: the helper is a separate process on a different machine with no
 * access to this build, and the format below is the contract between them.
 * Change one and you must change the other.
 */

/** Long enough to survive a slow paste, short enough to be worth little. */
export const TOKEN_LIFETIME_MS = 5 * 60 * 1000;

const SEPARATOR = ".";

function sign(secret: string, expiresAtMs: number): string {
  return createHmac("sha256", secret).update(String(expiresAtMs)).digest("hex");
}

export function mintHelperToken(secret: string, expiresAtMs: number): string {
  return `${expiresAtMs}${SEPARATOR}${sign(secret, expiresAtMs)}`;
}

/**
 * True when `token` was signed by `secret` and has not expired.
 *
 * Never throws: a malformed token is simply invalid, and this is reached
 * straight from a request header.
 */
export function verifyHelperToken(
  secret: string,
  token: string,
  nowMs: number,
): boolean {
  const separator = token.indexOf(SEPARATOR);
  if (separator < 1) return false;

  const expiresAtMs = Number(token.slice(0, separator));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) return false;

  const supplied = Buffer.from(token.slice(separator + 1), "utf8");
  const expected = Buffer.from(sign(secret, expiresAtMs), "utf8");
  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first. That leaks only the length of a hex digest, which is a constant.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}
