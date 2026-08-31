#!/usr/bin/env node
/**
 * Applies neon/migrations/*.sql to the database in DATABASE_URL.
 *
 * Neon's HTTP driver sends one statement per round trip, so each file is split
 * on statement boundaries and applied in order. Every migration is written to
 * be idempotent (`create table if not exists`, `create index if not exists`),
 * so re-running this is safe and is the intended way to apply a new file.
 *
 *   node scripts/migrate.mjs
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

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

/**
 * Split a migration into statements. Comments are stripped first so a `;`
 * inside one can't end a statement early.
 */
function statements(sqlText) {
  return sqlText
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const sql = neon(loadDatabaseUrl());
const dir = path.join(ROOT, "neon", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("no migrations found in neon/migrations");
  process.exit(0);
}

for (const file of files) {
  const stmts = statements(readFileSync(path.join(dir, file), "utf8"));
  process.stdout.write(`${file}: ${stmts.length} statements ... `);
  for (const stmt of stmts) {
    await sql.query(stmt);
  }
  console.log("applied");
}

console.log("\nmigrations complete");
