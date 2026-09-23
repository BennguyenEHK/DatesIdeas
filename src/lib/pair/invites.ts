import "server-only";

import { hashTicket, isTicket, newTicket } from "./ticket";

/**
 * One-time invitations onto an album, from a device that is on it to one that
 * is not.
 *
 * A code is shaped exactly like a season ticket -- 128 random bits, base64url
 * -- and is hashed the same way, for the same reasons `ticket.ts` gives. It is
 * never typed by a person; it travels only over the room's data channel, so
 * its length costs nothing. What keeps it harmless is that it lasts five
 * minutes and opens the album once.
 */

type QueryTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown>;

/** Five minutes: long enough for a slow phone, short enough to be forgotten. */
export const INVITE_TTL_MS = 5 * 60 * 1000;

/**
 * Mints an invitation for a pair and hands back the code ONCE.
 *
 * Only the hash is stored, so the code exists in this response and in the
 * data channel message it becomes, and nowhere else.
 */
export async function createInvite(
  sql: QueryTag,
  pairId: string,
  now: number = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
  const code = newTicket();
  const expiresAt = now + INVITE_TTL_MS;
  await sql`
    INSERT INTO pair_invites (code_hash, pair_id, expires_at)
    VALUES (${hashTicket(code)}, ${pairId}, ${new Date(expiresAt).toISOString()})
  `;
  return { code, expiresAt };
}

/**
 * Redeems an invitation, or null.
 *
 * The check and the marking are one statement. Were they two, two devices
 * holding the same code could both read "unused" before either wrote "used",
 * and one invitation would let in two devices. As a single UPDATE, Postgres
 * lets exactly one of them match the row.
 *
 * Expiry is compared against the same clock that set it, the app's, so an
 * invitation lasts five minutes however far the database's clock has drifted
 * from ours.
 *
 * One outcome for every way of failing -- malformed, unknown, used, expired --
 * for the reason `findPairByTicket` gives: a stranger learns nothing from
 * which guess was wrong.
 */
export async function claimInvite(
  sql: QueryTag,
  code: string,
  now: number = Date.now(),
): Promise<{ pairId: string } | null> {
  // Refused before the database is asked anything, because this is reachable
  // by anyone on the internet without a key.
  if (!isTicket(code)) return null;
  const rows = await sql`
    UPDATE pair_invites SET used_at = now()
    WHERE code_hash = ${hashTicket(code)}
      AND used_at IS NULL
      AND expires_at > ${new Date(now).toISOString()}
    RETURNING pair_id
  `;
  if (!Array.isArray(rows)) return null;
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) return null;
  const pairId = (row as Record<string, unknown>).pair_id;
  return typeof pairId === "string" ? { pairId } : null;
}
