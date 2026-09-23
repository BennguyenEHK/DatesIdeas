import "server-only";

import { randomBytes } from "node:crypto";

import { hashTicket, isTicket, newTicket } from "./ticket";

/**
 * The shape of Neon's tagged-template client, narrowed to what is used here.
 * Same contract as `src/lib/keepsakes/store.ts`, for the same reason: it lets
 * callers pass Neon directly while tests pass something trivially fake.
 */
export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

type QueryTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown>;

export interface Pair {
  id: string;
  createdAt: string;
}

function readPair(rows: unknown): Pair | null {
  if (!Array.isArray(rows)) return null;
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  const createdAt =
    record.created_at instanceof Date
      ? record.created_at.toISOString()
      : typeof record.created_at === "string"
        ? record.created_at
        : new Date(0).toISOString();
  return { id: record.id, createdAt };
}

/** A key's name, for revocation. Not a secret; knowing it opens nothing. */
function newKeyId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Creates a pair and hands back the ticket ONCE.
 *
 * The only moment the secret exists outside a browser. It is returned, never
 * stored, and never logged -- the row keeps its hash, so this value cannot be
 * recovered afterwards by us or by anyone who reads the database. If the
 * caller loses it here, the pair is unreachable and the remedy is a new one.
 *
 * The pair and its first device key are written by one statement, so there is
 * never a pair whose only key is missing from pair_keys. pairs.key_hash is
 * still filled in because it is the fallback lookup for one release.
 */
export async function createPair(
  sql: QueryTag,
): Promise<{ pair: Pair; ticket: string } | null> {
  const ticket = newTicket();
  const keyHash = hashTicket(ticket);
  const rows = await sql`
    WITH created AS (
      INSERT INTO pairs (key_hash) VALUES (${keyHash})
      RETURNING id, created_at
    ), first_key AS (
      INSERT INTO pair_keys (id, pair_id, key_hash, created_at)
      SELECT ${newKeyId()}, id, ${keyHash}, created_at FROM created
    )
    SELECT id, created_at FROM created
  `;
  const pair = readPair(rows);
  return pair === null ? null : { pair, ticket };
}

/**
 * Finds the pair a ticket opens, or null.
 *
 * One outcome for every way of failing -- malformed, unknown, rotated away,
 * revoked. Callers must not distinguish them: telling a stranger holding a
 * guess which guess was closest is the whole thing this is defending against,
 * and it is the same reasoning `Gone()` in `src/app/k/[id]/page.tsx` already
 * follows.
 *
 * Each device's key lives in pair_keys. The lookup there also stamps
 * last_seen_at in the same statement, rather than as a second write after it:
 * this runs at the start of every album request, and one round trip that both
 * finds the key and notes the visit is cheaper than two, and cannot leave a
 * half-done write behind. pairs.key_hash is asked only when pair_keys has no
 * match, as the fallback for a key the 0011 backfill did not copy.
 */
export async function findPairByTicket(
  sql: QueryTag,
  ticket: string,
): Promise<Pair | null> {
  // Shape-checked before the database is asked anything. This route is
  // reachable by anyone on the internet, and a malformed ticket is not worth a
  // round trip.
  if (!isTicket(ticket)) return null;
  const keyHash = hashTicket(ticket);
  const keyed = await sql`
    UPDATE pair_keys SET last_seen_at = now()
    FROM pairs
    WHERE pair_keys.key_hash = ${keyHash} AND pairs.id = pair_keys.pair_id
    RETURNING pairs.id, pairs.created_at
  `;
  const pair = readPair(keyed);
  if (pair !== null) return pair;
  const rows = await sql`
    SELECT id, created_at FROM pairs WHERE key_hash = ${keyHash}
  `;
  return readPair(rows);
}

/**
 * Issues a new ticket for an existing pair and voids every other key.
 *
 * An UPDATE, emphatically not an INSERT into pairs. album_items and occasions
 * reference pairs(id), so minting a second pair row would leave the entire
 * album attached to an identity nobody can open any more -- revocation that
 * destroys what it was protecting. The row keeps its id; only the keys change.
 *
 * Every other device is signed out by this: all of the pair's rows in
 * pair_keys go, one new key takes their place, and pairs.key_hash is set to
 * match so the fallback lookup cannot let an old key back in. One statement,
 * so no moment exists where the pair has no key at all. That is what
 * revocation means and the screen offering it has to say so.
 */
export async function rotateTicket(
  sql: QueryTag,
  pairId: string,
): Promise<string | null> {
  const ticket = newTicket();
  const keyHash = hashTicket(ticket);
  const rows = await sql`
    WITH rotated AS (
      UPDATE pairs SET key_hash = ${keyHash}
      WHERE id = ${pairId}
      RETURNING id, created_at
    ), forgotten AS (
      DELETE FROM pair_keys WHERE pair_id IN (SELECT id FROM rotated)
    ), fresh AS (
      INSERT INTO pair_keys (id, pair_id, key_hash)
      SELECT ${newKeyId()}, id, ${keyHash} FROM rotated
    )
    SELECT id, created_at FROM rotated
  `;
  return readPair(rows) === null ? null : ticket;
}

/**
 * Gives a pair one more device, and hands back that device's ticket ONCE.
 *
 * The same rule as `createPair`: the ticket is returned, the row keeps only
 * its hash. The insert selects from pairs rather than trusting the id, so a
 * pair deleted a moment ago yields null instead of a foreign-key error.
 */
export async function addKey(
  sql: QueryTag,
  pairId: string,
): Promise<{ keyId: string; ticket: string } | null> {
  const ticket = newTicket();
  const keyId = newKeyId();
  const rows = await sql`
    INSERT INTO pair_keys (id, pair_id, key_hash)
    SELECT ${keyId}, id, ${hashTicket(ticket)} FROM pairs WHERE id = ${pairId}
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0 ? { keyId, ticket } : null;
}

/**
 * Takes one device off the album.
 *
 * Scoped by pair as well as by key, so a caller can only ever remove its own
 * pair's keys; somebody else's key id simply matches nothing. And never the
 * last key: a pair with no keys is an album nobody can open again, which is
 * the one outcome this app treats as unrecoverable. The count is checked in
 * the same statement as the delete so the two cannot drift apart between
 * round trips.
 */
export async function revokeKey(
  sql: QueryTag,
  pairId: string,
  keyId: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM pair_keys
    WHERE id = ${keyId} AND pair_id = ${pairId}
      AND (SELECT count(*) FROM pair_keys WHERE pair_id = ${pairId}) > 1
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * The key id a ticket belongs to, or null.
 *
 * Only for telling a device which of the pair's keys is its own, so that
 * revoke can refuse to sign the caller out from under itself.
 */
export async function keyIdForTicket(
  sql: QueryTag,
  ticket: string,
): Promise<string | null> {
  if (!isTicket(ticket)) return null;
  const rows = await sql`
    SELECT id FROM pair_keys WHERE key_hash = ${hashTicket(ticket)}
  `;
  if (!Array.isArray(rows)) return null;
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) return null;
  const id = (row as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

/**
 * Attaches a room to a pair, so an evening can save into the album.
 *
 * Only while the room is open. A closed room being adopted would let a code
 * somebody once saw reach an album that did not exist when they saw it.
 *
 * And never over another pair's claim. A six-character code is guessable
 * enough that two different couples reaching the same one is a question of
 * when rather than whether, and the second must not be able to relabel the
 * first's evening. Returning false here means "somebody else has this room",
 * which callers should treat as ordinary rather than as an error.
 */
export async function linkRoomToPair(
  sql: QueryTag,
  roomCode: string,
  pairId: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE couples SET pair_id = ${pairId}
    WHERE code = ${roomCode} AND expires_at > now()
      AND (pair_id IS NULL OR pair_id = ${pairId})
    RETURNING code
  `;
  return Array.isArray(rows) && rows.length > 0;
}
