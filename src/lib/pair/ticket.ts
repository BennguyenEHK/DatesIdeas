import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The season ticket: the one long-lived secret in an app with no passwords.
 *
 * A room code is six characters from an unambiguous alphabet because somebody
 * reads it off a screen and types it into a phone. A season ticket is never
 * typed -- it arrives as a link or a QR -- so it is sized for the opposite
 * concern. It opens an album that does not expire, which means an attacker has
 * forever to guess it, so 128 bits of randomness is the floor rather than a
 * flourish.
 *
 * server-only, and imported that way on purpose. Nothing in the browser needs
 * to mint or hash a ticket; an accidental client import should fail the build
 * rather than ship a hashing routine next to the secret it hashes.
 */

/** 16 bytes = 128 bits, encoded base64url as 22 characters with no padding. */
export const TICKET_BYTES = 16;
export const TICKET_LENGTH = 22;

/** base64url, so a ticket survives being a path segment untouched. */
const TICKET_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** A fresh season ticket. The only place one is ever created. */
export function newTicket(): string {
  return randomBytes(TICKET_BYTES).toString("base64url");
}

/**
 * Whether a string is shaped like a ticket.
 *
 * Cheap rejection before the database is asked anything, which matters because
 * this runs on a route anyone on the internet can call. A malformed ticket is
 * refused without a query; only a well-formed one is worth a round trip.
 */
export function isTicket(value: unknown): value is string {
  return typeof value === "string" && TICKET_PATTERN.test(value);
}

/**
 * What the database stores.
 *
 * Plain sha-256 with no salt and no work factor, and that is correct here
 * rather than a shortcut. Password hashing is slow because passwords are
 * guessable -- people pick them, and a fast hash lets an attacker try a
 * dictionary. A ticket is 128 bits of `randomBytes`; there is no dictionary,
 * no rainbow table can be built against a space that size, and a salt would
 * protect against precomputation that is already impossible.
 *
 * What the hash actually buys is this: somebody who reads the database still
 * cannot open the album.
 */
export function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket, "utf8").digest("hex");
}

/**
 * Compares two hashes without leaking, through timing, how far they matched.
 *
 * Used where a hash is compared in this process. It is NOT what protects the
 * database lookup -- `where key_hash = $1` runs on an index and is not
 * constant-time, and cannot be made so. That lookup is safe for a different
 * reason: the input is 128 random bits, so timing tells an attacker nothing
 * they could finish acting on. This exists for the in-process comparisons
 * where constant time costs nothing, not because the other path is unsafe.
 */
export function ticketHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal if it escaped. Different lengths mean different hashes.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
