#!/usr/bin/env node
/**
 * Shows what is actually in the database.
 *
 *   node scripts/db-status.mjs                 # counts and recent sessions
 *   node scripts/db-status.mjs --purge-test    # delete rows from test rooms
 *
 * `--purge-test` only removes rooms whose code starts with T, SWEEP, or ZZZZ,
 * which is the convention the e2e script uses. It never touches real rooms.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const url =
  process.env.DATABASE_URL ??
  (existsSync(path.join(ROOT, ".env.local"))
    ? readFileSync(path.join(ROOT, ".env.local"), "utf8")
        .split("\n")
        .find((l) => l.startsWith("DATABASE_URL="))
        ?.slice("DATABASE_URL=".length)
        .trim()
    : undefined);

if (!url) throw new Error("DATABASE_URL not set and not found in .env.local");
const sql = neon(url);

if (process.argv.includes("--purge-test")) {
  const s = await sql`
    DELETE FROM signals
    WHERE room_code LIKE 'T%' OR room_code LIKE 'SWEEP%' OR room_code LIKE 'ZZZ%'
    RETURNING id
  `;
  const c = await sql`
    DELETE FROM couples
    WHERE code LIKE 'T%' OR code LIKE 'SWEEP%' OR code LIKE 'ZZZ%'
    RETURNING code
  `;
  console.log(`purged ${s.length} signal rows and ${c.length} test rooms`);
}

const [{ signals, couples, sessions, participants, oldest }] = await sql`
  SELECT
    (SELECT count(*) FROM signals)::int      AS signals,
    (SELECT count(*) FROM couples)::int      AS couples,
    (SELECT count(*) FROM sessions)::int     AS sessions,
    (SELECT count(*) FROM participants)::int AS participants,
    (SELECT min(created_at) FROM signals)    AS oldest
`;

console.log(`
signals       ${signals}${oldest ? `  (oldest ${new Date(oldest).toISOString()})` : ""}
couples       ${couples}
sessions      ${sessions}
participants  ${participants}`);

const recent = await sql`
  SELECT couple_code, started_at, ended_at, memes_sent
  FROM sessions ORDER BY started_at DESC LIMIT 5
`;
if (recent.length) {
  console.log("\nrecent sessions");
  for (const r of recent) {
    const total = Object.values(r.memes_sent ?? {}).reduce((a, b) => a + b, 0);
    console.log(
      `  ${r.couple_code}  ${new Date(r.started_at).toISOString()}  ` +
        `${r.ended_at ? "closed" : "open"}  ${total} reactions`,
    );
  }
}
