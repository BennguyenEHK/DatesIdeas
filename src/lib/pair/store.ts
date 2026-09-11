import "server-only";

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

/**
 * Creates a pair and hands back the ticket ONCE.
 *
 * The only moment the secret exists outside a browser. It is returned, never
 * stored, and never logged -- the row keeps its hash, so this value cannot be
 * recovered afterwards by us or by anyone who reads the database. If the
 * caller loses it here, the pair is unreachable and the remedy is a new one.
 */
export async function createPair(
  sql: QueryTag,
): Promise<{ pair: Pair; ticket: string } | null> {
  const ticket = newTicket();
  const rows = await sql`
    INSERT INTO pairs (key_hash) VALUES (${hashTicket(ticket)})
    RETURNING id, created_at
  `;
  const pair = readPair(rows);
  return pair === null ? null : { pair, ticket };
}

/**
 * Finds the pair a ticket opens, or null.
 *
 * One outcome for every way of failing -- malformed, unknown, rotated away.
 * Callers must not distinguish them: telling a stranger holding a guess which
 * guess was closest is the whole thing this is defending against, and it is
 * the same reasoning `Gone()` in `src/app/k/[id]/page.tsx` already follows.
 */
export async function findPairByTicket(
  sql: QueryTag,
  ticket: string,
): Promise<Pair | null> {
  // Shape-checked before the database is asked anything. This route is
  // reachable by anyone on the internet, and a malformed ticket is not worth a
  // round trip.
  if (!isTicket(ticket)) return null;
  const rows = await sql`
    SELECT id, created_at FROM pairs WHERE key_hash = ${hashTicket(ticket)}
  `;
  return readPair(rows);
}

/**
 * Issues a new ticket for an existing pair and voids the old one.
 *
 * An UPDATE, emphatically not an INSERT. album_items and occasions reference
 * pairs(id), so minting a second pair row would leave the entire album
 * attached to an identity nobody can open any more -- revocation that destroys
 * what it was protecting. The row keeps its id; only the key changes.
 *
 * Every other device is signed out by this, because every other device holds
 * the old secret. That is what revocation means and the screen offering it has
 * to say so.
 */
export async function rotateTicket(
  sql: QueryTag,
  pairId: string,
): Promise<string | null> {
  const ticket = newTicket();
  const rows = await sql`
    UPDATE pairs SET key_hash = ${hashTicket(ticket)}
    WHERE id = ${pairId}
    RETURNING id, created_at
  `;
  return readPair(rows) === null ? null : ticket;
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
