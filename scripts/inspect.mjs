#!/usr/bin/env node
/** Prints the live schema so a migration can be checked against the spec. */
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

const sql = neon(url);

const cols = await sql`
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`;

let current = null;
for (const c of cols) {
  if (c.table_name !== current) {
    current = c.table_name;
    console.log(`\n${current}`);
  }
  const def = c.column_default ? ` default ${c.column_default}` : "";
  const nul = c.is_nullable === "NO" ? " not null" : "";
  console.log(`  ${c.column_name.padEnd(14)} ${c.data_type}${nul}${def}`);
}

const idx = await sql`
  SELECT tablename, indexname FROM pg_indexes
  WHERE schemaname = 'public' ORDER BY tablename, indexname
`;
console.log("\nindexes");
for (const i of idx) console.log(`  ${i.tablename}.${i.indexname}`);
