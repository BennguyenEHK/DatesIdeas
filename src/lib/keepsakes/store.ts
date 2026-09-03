import "server-only";

/**
 * The shape of Neon's tagged-template client, narrowed to what is used here.
 */
export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

export type KeepsakeKind = "strip" | "clip";

/** How long a share id is, in characters. */
export const SHARE_ID_LENGTH = 10;

/**
 * Unambiguous lowercase alphabet: no l, no 1, no o, no 0.
 * These ids are read off a screen and occasionally typed.
 */
export const SHARE_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Makes a compact id that can survive being read aloud or typed from a QR
 * landing page. Falling back preserves sharing where Web Crypto is absent.
 */
export function newShareId(): string {
  const bytes = new Uint8Array(SHARE_ID_LENGTH);
  let usedCrypto = false;

  try {
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      globalThis.crypto.getRandomValues(bytes);
      usedCrypto = true;
    }
  } catch {
    // Some server-like test and edge environments expose no usable Web Crypto.
  }

  if (!usedCrypto) {
    for (let index = 0; index < bytes.length; index += 1) {
      try {
        bytes[index] = Math.floor(Math.random() * 256);
      } catch {
        // An id is preferable to a failed upload even in a constrained runtime.
        bytes[index] = 0;
      }
    }
  }

  return Array.from(bytes, (byte) => SHARE_ID_ALPHABET[byte % SHARE_ID_ALPHABET.length]).join("");
}

/** Reject impossible public ids before they become database work. */
export function isShareId(value: string): boolean {
  if (value.length !== SHARE_ID_LENGTH) return false;
  return Array.from(value).every((character) => SHARE_ID_ALPHABET.includes(character));
}

export interface Keepsake {
  id: string;
  roomCode: string;
  objectKey: string;
  kind: KeepsakeKind;
  contentType: string;
}

// Neon exposes a wider result union than this module needs. Accepting that
// promise-like shape lets callers inject Neon directly while the public
// `SqlTag` overload remains a precise, easy-to-fake contract for tests.
type QueryTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown>;

/** Records a keepsake only while the room that made it remains open. */
export function rememberKeepsake(sql: SqlTag, keepsake: Keepsake): Promise<boolean>;
export function rememberKeepsake(sql: QueryTag, keepsake: Keepsake): Promise<boolean>;
export async function rememberKeepsake(sql: QueryTag, keepsake: Keepsake): Promise<boolean> {
  // The liveness test lives in this statement so expiry cannot slip between a
  // preliminary check and the insert.
  const rows = await sql`
    INSERT INTO keepsakes (id, room_code, object_key, kind, content_type)
    SELECT ${keepsake.id}, ${keepsake.roomCode}, ${keepsake.objectKey}, ${keepsake.kind}, ${keepsake.contentType}
    WHERE EXISTS (
      SELECT 1 FROM couples WHERE code = ${keepsake.roomCode} AND expires_at > now()
    )
    RETURNING id
  `;

  return Array.isArray(rows) && rows.length > 0;
}

/** Finds a live keepsake without allowing stale rooms to reveal their files. */
export function findKeepsake(sql: SqlTag, id: string): Promise<Keepsake | null>;
export function findKeepsake(sql: QueryTag, id: string): Promise<Keepsake | null>;
export async function findKeepsake(sql: QueryTag, id: string): Promise<Keepsake | null> {
  if (!isShareId(id)) return null;

  // Joining the room into the lookup keeps the read subject to the same expiry
  // boundary as the write, rather than trusting a room checked moments ago.
  const rows = await sql`
    SELECT keepsakes.id, keepsakes.room_code, keepsakes.object_key,
           keepsakes.kind, keepsakes.content_type
    FROM keepsakes
    INNER JOIN couples ON couples.code = keepsakes.room_code
    WHERE keepsakes.id = ${id} AND couples.expires_at > now()
  `;

  if (!Array.isArray(rows)) return null;

  const row = rows[0];
  if (
    row === undefined ||
    typeof row !== "object" ||
    row === null ||
    Array.isArray(row) ||
    typeof row.id !== "string" ||
    typeof row.room_code !== "string" ||
    typeof row.object_key !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.content_type !== "string" ||
    (row.kind !== "strip" && row.kind !== "clip")
  ) {
    return null;
  }

  return {
    id: row.id,
    roomCode: row.room_code,
    objectKey: row.object_key,
    kind: row.kind,
    contentType: row.content_type,
  };
}
