/**
 * Set up the ISOLATED test database (homigo_test). Run once before `bun test`,
 * or after a schema change. SAFE — only ever touches a database whose name contains "test"
 * (or the historical local clone `homigo_p39`).
 *
 *   bun run test:setup
 *
 * Steps: create the DB if needed → `prisma db push` → apply custom SQL that db push
 * does NOT generate (Postgres sequences live in migrations, not schema.prisma).
 *
 * Custom SQL is applied through `prisma db execute` against DATABASE_URL so GitHub
 * Actions and Linux containers work without `docker exec homigo-postgres`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "homigo-postgres";
const TEST_DB = "homigo_test";
const DEFAULT_URL = `postgresql://postgres:homigo_dev@localhost:5433/${TEST_DB}`;
const MIGRATIONS = join(import.meta.dir, "..", "prisma", "migrations");

function testDatabaseUrl(): string {
  const injected = process.env.HOMIGO_TEST_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL;
  const dbName = injected.split("/").pop()?.split("?")[0] ?? "";
  if (/test/i.test(dbName) || dbName === "homigo_p39") return injected;
  return DEFAULT_URL;
}

const TEST_URL = testDatabaseUrl();

function dockerPsql(db: string, sql: string) {
  return spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-c", sql], {
    encoding: "utf8",
  });
}

function prismaExecute(sql: string) {
  return spawnSync("bunx", ["prisma", "db", "execute", "--stdin"], {
    encoding: "utf8",
    input: sql,
    env: { ...process.env, DATABASE_URL: TEST_URL },
  });
}

console.log(`① ensure database (url db=${TEST_URL.split("/").pop()?.split("?")[0]})`);
const dockerExists = dockerPsql("postgres", `SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'`);
if (dockerExists.status === 0 && !dockerExists.stdout?.includes("1 row")) {
  dockerPsql("postgres", `CREATE DATABASE ${TEST_DB}`);
}

console.log("② prisma db push (schema → isolated test DB)");
const push = spawnSync("bunx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  encoding: "utf8",
  env: { ...process.env, DATABASE_URL: TEST_URL },
});
process.stdout.write((push.stdout ?? "").split("\n").slice(-3).join("\n") + "\n");
if (push.status !== 0) {
  console.error(push.stderr);
  process.exit(push.status ?? 1);
}

console.log("③ apply custom migration SQL db push can't generate (sequences, indexes)");
let applied = 0;
for (const dir of readdirSync(MIGRATIONS).sort()) {
  const file = join(MIGRATIONS, dir, "migration.sql");
  let sql = "";
  try {
    sql = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!/CREATE SEQUENCE|CREATE UNIQUE INDEX|search_vector|tsvector/i.test(sql)) continue;
  const filtered = sql
    .split(/;\s*\n/)
    .map((stmt) => stmt.trim())
    .filter(
      (stmt) =>
        /^(CREATE SEQUENCE|CREATE UNIQUE INDEX)/i.test(stmt) ||
        /ADD COLUMN\s+"search_vector"/i.test(stmt) ||
        /USING GIN \("search_vector"\)/i.test(stmt) ||
        /ALTER COLUMN "(service_categories|service_regions|working_days|certifications)" SET (DEFAULT|NOT NULL)/i.test(stmt) ||
        /UPDATE "providers" SET "(service_regions|working_days|certifications)" = '\{\}' WHERE/i.test(stmt),
    )
    .map((stmt) => (stmt.endsWith(";") ? stmt : `${stmt};`))
    .join("\n");
  if (!filtered) continue;
  const r = prismaExecute(filtered);
  if (r.status === 0) {
    applied++;
    console.log(`   applied ${dir}`);
  } else {
    const err = `${r.stderr ?? ""} ${r.stdout ?? ""}`.trim().split("\n").pop();
    console.error(`   ⚠️ ${dir}: ${err}`);
  }
}

console.log("④ provider array NOT NULL/DEFAULT (db push does not keep these)");
prismaExecute(`
UPDATE providers SET service_categories = '{}' WHERE service_categories IS NULL;
UPDATE providers SET service_regions = '{}' WHERE service_regions IS NULL;
UPDATE providers SET working_days = '{}' WHERE working_days IS NULL;
UPDATE providers SET certifications = '{}' WHERE certifications IS NULL;
ALTER TABLE providers ALTER COLUMN service_categories SET DEFAULT '{}';
ALTER TABLE providers ALTER COLUMN service_regions SET DEFAULT '{}';
ALTER TABLE providers ALTER COLUMN working_days SET DEFAULT '{}';
ALTER TABLE providers ALTER COLUMN certifications SET DEFAULT '{}';
ALTER TABLE providers ALTER COLUMN service_categories SET NOT NULL;
ALTER TABLE providers ALTER COLUMN service_regions SET NOT NULL;
ALTER TABLE providers ALTER COLUMN working_days SET NOT NULL;
ALTER TABLE providers ALTER COLUMN certifications SET NOT NULL;
`);

console.log("⑤ clear stale encryption_keys (fresh DEK on next encrypt)");
prismaExecute("DELETE FROM encryption_keys;");

console.log("⑥ apply late additive migrations when prisma db push left a stale test DB");
const LATE_ADDITIVE: Array<{ object: string; dir: string }> = [
  { object: "ml_model_versions", dir: "20260906090000_ml_model_governance" },
  { object: "ai_budget_policies", dir: "20260907090000_phase14_governance" },
  { object: "ai_workflow_drafts", dir: "20260908090000_phase15_workflow_drafts" },
];
for (const { object, dir } of LATE_ADDITIVE) {
  const probe = prismaExecute(`SELECT to_regclass('public.${object}') AS t;`);
  const present = `${probe.stdout ?? ""} ${probe.stderr ?? ""}`.includes(object);
  if (present) {
    console.log(`   ${object} already present`);
    continue;
  }
  const file = join(MIGRATIONS, dir, "migration.sql");
  let sql = "";
  try {
    sql = readFileSync(file, "utf8");
  } catch {
    console.error(`   ⚠️ missing ${dir}/migration.sql`);
    continue;
  }
  const r = prismaExecute(sql);
  if (r.status === 0) {
    console.log(`   applied ${dir} (was missing ${object})`);
  } else {
    const err = `${r.stderr ?? ""} ${r.stdout ?? ""}`.trim().split("\n").pop();
    console.error(`   ⚠️ ${dir}: ${err}`);
  }
}
prismaExecute(`ALTER TYPE "PartnerLifecycleState" ADD VALUE IF NOT EXISTS 'VERIFIED';`);
prismaExecute(`ALTER TYPE "retention_category" ADD VALUE IF NOT EXISTS 'AI_TELEMETRY';`);
prismaExecute(`ALTER TYPE "retention_category" ADD VALUE IF NOT EXISTS 'AUTOMATION_TELEMETRY';`);
prismaExecute(`ALTER TYPE "retention_category" ADD VALUE IF NOT EXISTS 'OPERATIONAL_ACTIVITY';`);
prismaExecute(`
DROP INDEX IF EXISTS "enterprise_audit_logs_trace_id_key";
CREATE INDEX IF NOT EXISTS "enterprise_audit_logs_trace_id_idx"
  ON "enterprise_audit_logs" ("trace_id");
`);

const seq = prismaExecute(
  "SELECT 1 FROM pg_class WHERE relname='journal_entry_number_seq';",
);
const seqOk = (seq.stdout ?? "").includes("1") || seq.status === 0;
console.log(
  `\n${seqOk ? "✅" : "❌"} test DB ready (custom SQL applied: ${applied}, journal sequence execute status=${seq.status})`,
);
process.exit(seq.status === 0 ? 0 : 1);
