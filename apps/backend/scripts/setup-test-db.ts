/**
 * Set up the ISOLATED test database (homigo_test). Run once before `bun test`,
 * or after a schema change. SAFE — only ever touches homigo_test, never the live DB.
 *
 *   bun run test:setup
 *
 * Steps: create the DB → `prisma db push` the full schema → apply custom SQL that
 * db push does NOT generate (Postgres sequences live in migrations, not schema.prisma).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "homigo-postgres";
const TEST_DB = "homigo_test";
const TEST_URL = `postgresql://postgres:homigo_dev@localhost:5433/${TEST_DB}`;
const MIGRATIONS = join(import.meta.dir, "..", "prisma", "migrations");

function psql(db: string, sql: string) {
  return spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-c", sql], { encoding: "utf8" });
}

console.log(`① ensure database ${TEST_DB}`);
const exists = psql("postgres", `SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'`).stdout?.includes("1 row");
if (!exists) psql("postgres", `CREATE DATABASE ${TEST_DB}`);

console.log("② prisma db push (schema → homigo_test)");
const push = spawnSync("bunx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  encoding: "utf8",
  env: { ...process.env, DATABASE_URL: TEST_URL },
});
process.stdout.write((push.stdout ?? "").split("\n").slice(-3).join("\n") + "\n");

console.log("③ apply custom migration SQL db push can't generate (sequences, etc.)");
let applied = 0;
for (const dir of readdirSync(MIGRATIONS)) {
  const file = join(MIGRATIONS, dir, "migration.sql");
  let sql = "";
  try { sql = readFileSync(file, "utf8"); } catch { continue; }
  // Only the bits `db push` cannot generate: custom sequences + partial/conditional
  // unique indexes (e.g. one-SENT-attempt-per-job).
  if (!/CREATE SEQUENCE|CREATE UNIQUE INDEX/i.test(sql)) continue;
  const r = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", TEST_DB], { input: sql, encoding: "utf8" });
  if (r.status === 0) { applied++; console.log(`   applied ${dir}`); }
  else console.error(`   ⚠️ ${dir}: ${(r.stderr ?? "").trim().split("\n").pop()}`);
}

// Clear envelope-encryption data keys so the test DB never carries a key wrapped
// with a stale master — the next encrypt generates a fresh one against the current
// ENCRYPTION_KEY (otherwise PII writes fail with a GCM auth error).
console.log("④ clear stale encryption_keys (fresh DEK on next encrypt)");
psql(TEST_DB, "DELETE FROM encryption_keys");

// Verify the journal sequence is present (the thing that bit us).
const seq = psql(TEST_DB, "SELECT 1 FROM pg_class WHERE relname='journal_entry_number_seq'").stdout?.includes("1 row");
console.log(`\n${seq ? "✅" : "❌"} homigo_test ready (custom SQL applied: ${applied}, journal sequence: ${seq ? "present" : "MISSING"})`);
process.exit(seq ? 0 : 1);
