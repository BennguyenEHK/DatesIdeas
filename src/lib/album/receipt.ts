import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proof that the server named an album file for this pair.
 *
 * Album files used to live under album/<pair id>/, and the confirm step checked
 * that folder against the caller's ticket. Files are now filed by date, so the
 * path no longer says whose they are. Instead, when an upload starts, the server
 * hands back a receipt: an HMAC over the pair and the exact key. Confirming a
 * key without a matching receipt is refused, so a pair can still only ever
 * record a file it was given -- and never one named for somebody else.
 *
 * Keyed from the storage secret, which every deployment that can upload at all
 * already has, with a fixed label so the same secret is never used bare for two
 * jobs.
 */

const LABEL = "festibooth album upload receipt v1";

/** The signing key, or null when storage is not configured. */
export function receiptSecret(): string | null {
  const secret = process.env.NEON_STORAGE_SECRET_ACCESS_KEY?.trim();
  return secret ? secret : null;
}

function sign(secret: string, pairId: string, objectKey: string): Buffer {
  return createHmac("sha256", secret).update(`${LABEL}\n${pairId}\n${objectKey}`).digest();
}

export function uploadReceipt(secret: string, pairId: string, objectKey: string): string {
  return sign(secret, pairId, objectKey).toString("base64url");
}

export function receiptMatches(
  secret: string,
  pairId: string,
  objectKey: string,
  receipt: unknown,
): boolean {
  if (typeof receipt !== "string" || receipt.length === 0) return false;
  const expected = sign(secret, pairId, objectKey);
  const given = Buffer.from(receipt, "base64url");
  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  return given.length === expected.length && timingSafeEqual(given, expected);
}
