/**
 * Phase 2 / 26 — build a brand-new database from migrations ONLY.
 *
 * Never uses `prisma db push`. Never touches homigo_db / production / staging.
 *
 *   bun run scripts/certify-fresh-migrate.ts
 *
 * Target: postgresql://postgres:homigo_dev@localhost:5433/homigo_cert_migrate
 * Override host/user via HOMIGO_CERT_DATABASE_URL only if the database name
 * contains "cert" or "test".
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { announceDdlTarget, assertDdlTarget } from "../src/lib/ddl-target-guard";

const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "homigo-postgres";
const CERT_DB = "homigo_cert_migrate";
const DEFAULT_URL = `postgresql://postgres:homigo_dev@localhost:5433/${CERT_DB}`;
const BACKEND = join(import.meta.dir, "..");

function databaseName(url: string): string {
  return url.split("/").pop()?.split("?")[0] ?? "";
}

function assertIsolated(url: string): void {
  const name = databaseName(url);
  if (!name || /prod|staging|homigo_db$/i.test(name)) {
    throw new Error(`refusing DATABASE_URL database "${name}" — isolated cert DB required`);
  }
  if (!/cert|test|mtest/i.test(name)) {
    throw new Error(`refusing DATABASE_URL database "${name}" — name must contain cert or test`);
  }
}

function certUrl(): string {
  const injected = process.env.HOMIGO_CERT_DATABASE_URL || DEFAULT_URL;
  assertIsolated(injected);
  return injected;
}

const URL = certUrl();
// The name checks above say what this script BELIEVES it is touching; the guard proves the url it
// will actually connect with agrees, and prints it. This script DROPs a database — the 2026-09-16
// incident was exactly a script that reached a database it had not named.
const ddlTarget = assertDdlTarget("test", URL);
announceDdlTarget("certify-fresh-migrate", ddlTarget);
const DB = ddlTarget.database;

function dockerPsql(db: string, sql: string) {
  return spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-c", sql], {
    encoding: "utf8",
  });
}

function run(label: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
  console.log(`→ ${label}`);
  const r = spawnSync(command, args, {
    encoding: "utf8",
    cwd: BACKEND,
    env,
    shell: process.platform === "win32",
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`FAIL ${label} exit=${r.status}`);
    process.exit(r.status ?? 1);
  }
}

console.log(`[certify-fresh-migrate] target database: ${DB}`);
console.log("[certify-fresh-migrate] method: prisma migrate deploy (no db push)");

const docker = dockerPsql("postgres", "SELECT 1");
if (docker.status !== 0) {
  console.error("BLOCKED — docker postgres unreachable (container homigo-postgres).");
  console.error((docker.stderr ?? docker.stdout ?? "").trim().split("\n").pop());
  process.exit(2);
}

console.log(`① drop+create ${DB}`);
const drop = dockerPsql("postgres", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
if (drop.status !== 0) {
  console.error(drop.stderr ?? drop.stdout);
  process.exit(1);
}
const create = dockerPsql("postgres", `CREATE DATABASE ${DB}`);
if (create.status !== 0) {
  console.error(create.stderr ?? create.stdout);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: URL };
run("prisma migrate deploy", "bunx", ["prisma", "migrate", "deploy"], env);
run("schema drift", "bun", ["run", "scripts/check-schema-drift.ts"], env);

/**
 * `--for-suite` additionally grants the ONE database-level setting that `setup-test-db.ts` gives
 * homigo_test: the opt-out from the financial-history delete guard (migration 20260920090000).
 *
 * Without it the schema is correct and the suite still fails: fixtures create bookings with
 * payments and wallet movements and then delete them, and the guard — rightly — refuses. That is
 * what happened on 2026-09-21: 10 failures on a migrations-built database that were entirely the
 * absence of this grant, and nothing to do with the migrations. The grant is a property of a
 * DISPOSABLE test database, not of the schema, which is why no migration carries it.
 */
if (process.argv.includes("--for-suite")) {
  const grant = dockerPsql("postgres", `ALTER DATABASE ${DB} SET homigo.allow_financial_purge = 'on'`);
  if (grant.status !== 0) {
    console.error(grant.stderr ?? grant.stdout);
    process.exit(1);
  }
  console.log(`② financial-history guard opted out on ${DB} only (disposable database)`);
}

console.log(`PASS fresh migrate + protected-object drift on ${DB}`);
