#!/usr/bin/env node
/**
 * Loads neon/seed/cards.json into the card_game table.
 *
 *   node scripts/seed-cards.mjs
 *   node scripts/seed-cards.mjs --replace   # clear the table first
 *
 * Safe to re-run: `on conflict (text) do nothing` means importing an updated
 * file adds the new questions and leaves the existing ones alone. Use
 * --replace only when you want the file to become the whole deck, since it
 * renumbers every id and any card ids already exchanged in a live room would
 * then point somewhere else.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MOODS = new Set(["light", "us", "deep"]);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(ROOT, ".env.local");
  if (!existsSync(envFile)) {
    throw new Error("DATABASE_URL is not set and .env.local does not exist");
  }
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env.local");
  return line.slice("DATABASE_URL=".length).trim();
}

const file = path.join(ROOT, "neon", "seed", "cards.json");
if (!existsSync(file)) {
  console.error(`missing ${file}`);
  process.exit(1);
}

const cards = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(cards)) throw new Error("cards.json must be an array");

// Validate before touching the database: a half-applied deck is worse than a
// rejected one, and the failure is far easier to read here than from a
// constraint violation mid-import.
const problems = [];
const seen = new Set();
cards.forEach((c, i) => {
  if (typeof c?.text !== "string" || !c.text.trim()) problems.push(`[${i}] empty text`);
  if (!MOODS.has(c?.mood)) problems.push(`[${i}] bad mood: ${JSON.stringify(c?.mood)}`);
  const key = c?.text?.trim().toLowerCase();
  if (key && seen.has(key)) problems.push(`[${i}] duplicate: ${c.text}`);
  if (key) seen.add(key);
});

if (problems.length) {
  console.error(`${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  process.exit(1);
}

const sql = neon(loadDatabaseUrl());

if (process.argv.includes("--replace")) {
  await sql`DELETE FROM card_game`;
  console.log("cleared card_game");
}

let added = 0;
for (const c of cards) {
  const rows = await sql`
    INSERT INTO card_game (text, mood, source)
    VALUES (${c.text.trim()}, ${c.mood}, ${c.source ?? null})
    ON CONFLICT (text) DO NOTHING
    RETURNING id
  `;
  if (rows.length) added += 1;
}

const [counts] = await sql`
  SELECT
    count(*)::int                                    AS total,
    count(*) FILTER (WHERE mood = 'light')::int      AS light,
    count(*) FILTER (WHERE mood = 'us')::int         AS us,
    count(*) FILTER (WHERE mood = 'deep')::int       AS deep
  FROM card_game
`;

console.log(
  `\nadded ${added} of ${cards.length}\n` +
    `deck now: ${counts.total} (light ${counts.light}, us ${counts.us}, deep ${counts.deep})\n`,
);
