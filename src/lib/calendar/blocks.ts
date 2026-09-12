import "server-only";

import { isRepeat, type BlockSeed, type Repeat } from "./recur";

export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

type QueryTag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

export interface TimeBlock extends BlockSeed {
  note: string | null;
  /** 'both', or a person's display name. Never 'mine'/'yours' -- see 0009. */
  owner: string;
  remindMinutes: number | null;
}

export interface NewTimeBlock {
  id: string;
  title: string;
  note: string | null;
  startsAt: string;
  endsAt: string;
  zone: string;
  owner: string;
  repeat: Repeat;
  repeatUntil: string | null;
  remindMinutes: number | null;
}

function instant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function civil(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

function readBlock(value: unknown): TimeBlock | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const startsAt = instant(row.starts_at);
  const endsAt = instant(row.ends_at);
  if (
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.zone !== "string" ||
    typeof row.owner !== "string" ||
    !isRepeat(row.repeat) ||
    startsAt === null ||
    endsAt === null ||
    !(typeof row.note === "string" || row.note === null)
  ) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    startsAt,
    endsAt,
    zone: row.zone,
    owner: row.owner,
    repeat: row.repeat,
    repeatUntil: row.repeat_until === null ? null : civil(row.repeat_until),
    remindMinutes:
      typeof row.remind_minutes === "number" ? row.remind_minutes : null,
  };
}

/**
 * Every block that could possibly show in a window.
 *
 * Deliberately generous at the start: a repeating block that began a year ago
 * still produces occurrences this week, so filtering on `starts_at >= from`
 * would hide exactly the blocks a calendar most needs. The expansion in
 * `recur.ts` does the real narrowing; this only avoids reading blocks that
 * begin after the window ends, and repeats that have already run out.
 */
export function listBlocks(sql: SqlTag, pairId: string, until: string): Promise<TimeBlock[]>;
export function listBlocks(sql: QueryTag, pairId: string, until: string): Promise<TimeBlock[]>;
export async function listBlocks(
  sql: QueryTag,
  pairId: string,
  until: string,
): Promise<TimeBlock[]> {
  const rows = await sql`
    SELECT id, title, note, starts_at, ends_at, zone, owner, repeat, repeat_until,
           remind_minutes
    FROM time_blocks
    WHERE pair_id = ${pairId}
      AND starts_at < ${until}::timestamptz
      AND (repeat = 'none' OR repeat_until IS NULL OR repeat_until >= current_date)
    ORDER BY starts_at ASC
    LIMIT 500
  `;
  return Array.isArray(rows)
    ? rows.map(readBlock).filter((block): block is TimeBlock => block !== null)
    : [];
}

export function insertBlock(sql: SqlTag, pairId: string, block: NewTimeBlock): Promise<boolean>;
export function insertBlock(sql: QueryTag, pairId: string, block: NewTimeBlock): Promise<boolean>;
export async function insertBlock(
  sql: QueryTag,
  pairId: string,
  block: NewTimeBlock,
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO time_blocks
      (id, pair_id, title, note, starts_at, ends_at, zone, owner, repeat,
       repeat_until, remind_minutes)
    VALUES (${block.id}, ${pairId}, ${block.title}, ${block.note},
            ${block.startsAt}::timestamptz, ${block.endsAt}::timestamptz,
            ${block.zone}, ${block.owner}, ${block.repeat},
            ${block.repeatUntil}::date, ${block.remindMinutes})
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export interface BlockPatch {
  title?: string;
  note?: string | null;
  startsAt?: string;
  endsAt?: string;
  owner?: string;
  repeat?: Repeat;
  repeatUntil?: string | null;
  remindMinutes?: number | null;
}

export function updateBlock(sql: SqlTag, pairId: string, id: string, patch: BlockPatch): Promise<boolean>;
export function updateBlock(sql: QueryTag, pairId: string, id: string, patch: BlockPatch): Promise<boolean>;
export async function updateBlock(
  sql: QueryTag,
  pairId: string,
  id: string,
  patch: BlockPatch,
): Promise<boolean> {
  const has = (key: keyof BlockPatch) => Object.hasOwn(patch, key);
  const rows = await sql`
    UPDATE time_blocks SET
      title = CASE WHEN ${has("title")} THEN ${patch.title ?? null} ELSE title END,
      note = CASE WHEN ${has("note")} THEN ${patch.note ?? null} ELSE note END,
      starts_at = CASE WHEN ${has("startsAt")} THEN ${patch.startsAt ?? null}::timestamptz ELSE starts_at END,
      ends_at = CASE WHEN ${has("endsAt")} THEN ${patch.endsAt ?? null}::timestamptz ELSE ends_at END,
      owner = CASE WHEN ${has("owner")} THEN ${patch.owner ?? null} ELSE owner END,
      repeat = CASE WHEN ${has("repeat")} THEN ${patch.repeat ?? null} ELSE repeat END,
      repeat_until = CASE WHEN ${has("repeatUntil")} THEN ${patch.repeatUntil ?? null}::date ELSE repeat_until END,
      remind_minutes = CASE WHEN ${has("remindMinutes")} THEN ${patch.remindMinutes ?? null} ELSE remind_minutes END,
      -- Any change to when it happens makes an already-sent reminder stale.
      reminded_for = CASE WHEN ${has("startsAt")} THEN NULL ELSE reminded_for END
    WHERE pair_id = ${pairId} AND id = ${id}
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export function deleteBlock(sql: SqlTag, pairId: string, id: string): Promise<boolean>;
export function deleteBlock(sql: QueryTag, pairId: string, id: string): Promise<boolean>;
export async function deleteBlock(sql: QueryTag, pairId: string, id: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM time_blocks WHERE pair_id = ${pairId} AND id = ${id} RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export interface ReminderRow extends TimeBlock {
  pairId: string;
  remindMinutes: number;
  remindedFor: string | null;
}

/**
 * Every block that might have a reminder due soon, across every pair.
 *
 * The only query in the app not scoped to one pair, because the sweep calling
 * it acts for nobody -- it runs on a schedule. So its route is the one route
 * guarded by a shared secret rather than a season ticket.
 *
 * Deliberately wide. Whether a reminder is actually due is decided by
 * dueOccurrence in remind.ts, which understands repeats; SQL cannot express the
 * next occurrence of a monthly block without reimplementing all of recur.ts
 * badly. This only keeps out rows that cannot possibly qualify.
 */
export function reminderCandidates(sql: SqlTag, now: Date): Promise<ReminderRow[]>;
export function reminderCandidates(sql: QueryTag, now: Date): Promise<ReminderRow[]>;
export async function reminderCandidates(sql: QueryTag, now: Date): Promise<ReminderRow[]> {
  const rows = await sql`
    SELECT id, pair_id, title, note, starts_at, ends_at, zone, owner, repeat,
           repeat_until, remind_minutes, reminded_for
    FROM time_blocks
    WHERE remind_minutes IS NOT NULL
      -- The longest allowed lead is a week, so nothing starting further out
      -- than that can be due yet.
      AND starts_at <= ${now.toISOString()}::timestamptz + interval '8 days'
      AND (
        (repeat = 'none' AND starts_at >= ${now.toISOString()}::timestamptz - interval '1 day')
        OR (repeat <> 'none' AND (repeat_until IS NULL OR repeat_until >= current_date - 1))
      )
    LIMIT 1000
  `;
  if (!Array.isArray(rows)) return [];
  const found: ReminderRow[] = [];
  for (const row of rows) {
    const block = readBlock(row);
    const record = row as Record<string, unknown>;
    if (block === null || typeof record.pair_id !== "string" || block.remindMinutes === null) continue;
    found.push({
      ...block,
      pairId: record.pair_id,
      remindMinutes: block.remindMinutes,
      remindedFor: record.reminded_for === null ? null : instant(record.reminded_for),
    });
  }
  return found;
}

/**
 * Claims one occurrence's reminder, and says whether this sweep won it.
 *
 * A claim rather than a mark-after-sending. Two sweeps can overlap -- a slow
 * run and the next scheduled one -- and marking after the send would let both
 * send. The conditional update is atomic, so exactly one of them gets `true`
 * and only that one pushes.
 */
export function claimReminder(sql: SqlTag, id: string, occurrence: string): Promise<boolean>;
export function claimReminder(sql: QueryTag, id: string, occurrence: string): Promise<boolean>;
export async function claimReminder(sql: QueryTag, id: string, occurrence: string): Promise<boolean> {
  const rows = await sql`
    UPDATE time_blocks SET reminded_for = ${occurrence}::timestamptz
    WHERE id = ${id}
      AND (reminded_for IS NULL OR reminded_for < ${occurrence}::timestamptz)
    RETURNING id
  `;
  return Array.isArray(rows) && rows.length > 0;
}
