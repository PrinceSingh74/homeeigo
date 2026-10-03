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

/**
 * Execute SQL against the isolated test database.
 *
 * ── Why `--url` is passed explicitly ─────────────────────────────────────────
 *
 * This used to rely on `env: { DATABASE_URL: TEST_URL }`. Since `prisma.config.ts` declares an
 * explicit `datasource.url`, the CLI stopped reading the environment and every single call — all
 * sixteen of them — failed with:
 *
 *   Error: Either --url or --schema must be provided.
 *
 * `spawnSync` reports that as a non-zero status, but most call sites only logged a warning, and the
 * ones that checked (the "invariant probe") ran through this same broken helper, so the probe could
 * not fail for the right reason either. The result was a setup script that printed
 * "✅ invariant constraints present" while having applied nothing at all: every sequence, index,
 * constraint, trigger and function it claims to create was silently skipped.
 *
 * `assertOk` makes a failure loud. A step that cannot apply its SQL must stop the script, not
 * decorate it.
 */
function prismaExecute(sql: string) {
  const q = (v: string) => (process.platform === "win32" ? `"${v}"` : v);
  return spawnSync("bunx", ["prisma", "db", "execute", "--url", q(TEST_URL), "--stdin"], {
    encoding: "utf8",
    input: sql,
    shell: process.platform === "win32", // cmd.exe splits the url on its '&' unless the shell quotes it
  });
}

/** Run SQL and abort the setup if it did not apply. Use for anything the suites then rely on. */
function prismaExecuteOrFail(sql: string, label: string) {
  const r = prismaExecute(sql);
  if (r.status !== 0) {
    const err = `${r.stderr ?? ""} ${r.stdout ?? ""}`.trim().split("\n").filter(Boolean).pop();
    console.error(`   ❌ ${label}: ${err}`);
    process.exit(1);
  }
  return r;
}

console.log(`① ensure database (url db=${TEST_URL.split("/").pop()?.split("?")[0]})`);
const dockerExists = dockerPsql("postgres", `SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'`);
if (dockerExists.status === 0 && !dockerExists.stdout?.includes("1 row")) {
  dockerPsql("postgres", `CREATE DATABASE ${TEST_DB}`);
}

/**
 * ①b Reconcile the raw-SQL objects `db push` cannot.
 *
 * `db push` diffs the live database against schema.prisma. The objects that exist ONLY in migration
 * SQL — the four booking slot columns, their EXCLUDE constraints, the slot trigger — are invisible
 * to schema.prisma, so push tries to DROP the columns, and Postgres refuses because the constraints
 * depend on them:
 *
 *   ERROR: cannot drop column provider_slot_end of table bookings because other objects depend on it
 *
 * Once step ③b began replaying those invariants, every subsequent `test:setup` on the same database
 * hit that wall — permanently. (CI never saw it: its Postgres service starts empty.) Dropping them
 * first is safe because ③b recreates them immediately and then PROVES they are present.
 *
 * `--reset` exists for the harder case: a database that has drifted far enough that push cannot
 * reconcile it at all (duplicate indexes, renamed constraints). Starting from empty is the only
 * honest way to get a known shape, and it is exactly what CI does on every run.
 */
const RESET = process.argv.includes("--reset");
if (RESET) {
  console.log("①b --reset: dropping and recreating the test database (known state, as CI has)");
  const drop = dockerPsql("postgres", `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  if (drop.status !== 0) {
    console.error(`   ❌ could not drop ${TEST_DB}: ${(drop.stderr ?? "").trim().split("\n").pop()}`);
    process.exit(1);
  }
  const create = dockerPsql("postgres", `CREATE DATABASE ${TEST_DB}`);
  if (create.status !== 0) {
    console.error(`   ❌ could not create ${TEST_DB}: ${(create.stderr ?? "").trim().split("\n").pop()}`);
    process.exit(1);
  }
} else {
  console.log("①b drop raw-SQL objects db push cannot reconcile (recreated in ③b)");
  prismaExecute(`
ALTER TABLE IF EXISTS "bookings" DROP CONSTRAINT IF EXISTS "bookings_provider_slot_excl";
ALTER TABLE IF EXISTS "bookings" DROP CONSTRAINT IF EXISTS "bookings_user_slot_excl";
DROP TRIGGER IF EXISTS bookings_conflict_slots_trg ON "bookings";
`);
}

/**
 * `--migrate` (implied by `--reset`): build an EMPTY test database from the migration history, exactly
 * as production is built (2026-10-01). The db push path below cannot produce a complete schema from
 * scratch — tables that exist only in migrations (businesses, booking_requirement_states,
 * booking_safety_holds, …) are not in schema.prisma, so a fresh push-built database failed ⑦ with
 * ~100 missing objects. That was the CI path too. The push path stays for existing push-built
 * databases; never point --migrate at one (migrate deploy refuses a non-empty, un-migrated schema).
 */
const MIGRATE = RESET || process.argv.includes("--migrate");
if (MIGRATE) {
  console.log("② prisma migrate deploy (the migration history → isolated test DB)");
  const deploy = spawnSync("bunx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_URL },
    shell: process.platform === "win32",
  });
  process.stdout.write((deploy.stdout ?? "").split("\n").filter((l) => /migration|applied|No pending/i.test(l)).slice(-3).join("\n") + "\n");
  if (deploy.status !== 0) {
    console.error((deploy.stderr ?? "").split("\n").slice(-8).join("\n"));
    process.exit(deploy.status ?? 1);
  }
  // Same deliberate, test-database-only opt-out as the push path (financial-history delete guard,
  // migration 20260920090000): fixtures here are created and deleted by design.
  const purgeDefault = prismaExecute(`ALTER DATABASE ${TEST_DB} SET homigo.allow_financial_purge = 'on';`);
  if (purgeDefault.status !== 0) {
    console.error(`   ❌ financial purge default: ${(purgeDefault.stderr ?? "").trim().split("\n").pop()}`);
    process.exit(1);
  }
  console.log("   ✅ financial-history guard opted out on the test database only");
  finish(0);
}

console.log("② prisma db push (schema → isolated test DB)");
const push = spawnSync("bunx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  encoding: "utf8",
  env: { ...process.env, DATABASE_URL: TEST_URL },
});
process.stdout.write((push.stdout ?? "").split("\n").slice(-3).join("\n") + "\n");
if (push.status !== 0) {
  console.error(push.stderr);
  // A drifted local database cannot always be reconciled in place (duplicate indexes, renamed
  // constraints). Say so, instead of leaving the engineer to re-run the same failing command.
  if (!RESET) {
    console.error("");
    console.error("  db push could not reconcile this database in place.");
    console.error("  Start from a known state (this is what CI does on every run):");
    console.error("      bun run test:setup -- --reset");
    console.error("");
  }
  process.exit(push.status ?? 1);
}

console.log("③ apply custom migration SQL db push can't generate (sequences, indexes)");
/**
 * An index's FINAL state across the whole migration history decides whether it is created here.
 * `20260612000000_assignment_one_sent_per_job` creates `assignment_attempts_one_sent_per_job`;
 * `20260616120000_assignment_broadcast_dispatch` and `20260824130000_…` drop it again. This step
 * replays only CREATE statements, so without this map it resurrected an index production does
 * not have (the broadcast-dispatch suites then failed on a --reset database).
 */
const stripComments = (stmt: string) => stmt.replace(/^(?:\s*--[^\n]*\n)+/, "").trim();
const finalIndexOp = new Map<string, "CREATE" | "DROP">();
for (const dir of readdirSync(MIGRATIONS).sort()) {
  let sql = "";
  try {
    sql = readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");
  } catch {
    continue;
  }
  for (const raw of sql.split(/;\s*\n/)) {
    const stmt = stripComments(raw);
    const created = stmt.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?"?(\w+)"?/i);
    const dropped = stmt.match(/^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF EXISTS\s+)?"?(\w+)"?/i);
    if (created) finalIndexOp.set(created[1], "CREATE");
    if (dropped) finalIndexOp.set(dropped[1], "DROP");
  }
}
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
    // Strip leading `--` comment lines before matching. The allowlist regexes are anchored, and a
    // migration whose first statement follows its header comment (e.g.
    // 20260919130000_document_number_sequences) had that statement silently dropped: a --reset test
    // DB (and CI, which always builds fresh) got withdrawal_number_seq but NOT wallet_txn_number_seq,
    // and 61 money suites failed with 42P01 (release certification Ph24 clean-environment run).
    .map(stripComments)
    .filter((stmt) => {
      const idx = stmt.match(/^CREATE\s+UNIQUE\s+INDEX\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i);
      return !(idx && finalIndexOp.get(idx[1]) === "DROP");
    })
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
  /**
   * One statement per call, not one batch per migration.
   *
   * These statements are replayed onto a database `db push` has already shaped, so a `CREATE UNIQUE
   * INDEX` for an index push already made fails with "already exists" — which is harmless. But the
   * whole migration used to be sent as ONE batch, and Postgres aborts the remainder of a failed
   * batch. A single benign duplicate therefore silently skipped every later statement in that file,
   * and the sequences live at the END of several of them: `journal_entry_number_seq` was never
   * created, so every ledger write in the suites failed with 42P01 while setup printed "⚠️" once and
   * moved on. Per-statement execution keeps a benign duplicate from eating a required sequence.
   */
  const statements = filtered.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
  let ok = 0;
  const hardErrors: string[] = [];
  for (const stmt of statements) {
    const r = prismaExecute(stmt.endsWith(";") ? stmt : `${stmt};`);
    if (r.status === 0) {
      ok++;
      continue;
    }
    const err = `${r.stderr ?? ""} ${r.stdout ?? ""}`.trim();
    // "already exists" means push got there first — that is the expected steady state, not a failure.
    if (/already exists/i.test(err)) continue;
    hardErrors.push(err.split("\n").filter(Boolean).pop() ?? "unknown");
  }
  if (ok > 0) applied++;
  if (hardErrors.length > 0) {
    console.error(`   ⚠️ ${dir}: ${hardErrors.length} statement(s) failed: ${hardErrors[0]}`);
  } else if (ok > 0) {
    console.log(`   applied ${dir} (${ok}/${statements.length} statements)`);
  }
}

/**
 * ③a The sequences are load-bearing: `nextWalletTxnNumber` / journal numbering read them on every
 * money write, so a missing one turns every ledger test into a 42P01 rather than a wrong number.
 * Create them explicitly and fail the setup if they are still absent.
 */
console.log("③a ensure money numbering sequences");
// Every numbering sequence production has, each from its migration:
//   journal_entry_number_seq  — 20260609300000_journal_entry_number_sequence
//   wallet_txn_number_seq     — 20260919130000_document_number_sequences
//   withdrawal_number_seq     — 20260919130000_document_number_sequences
// (booking numbers use the document_sequences table, not a sequence).
for (const seq of ["journal_entry_number_seq", "wallet_txn_number_seq", "withdrawal_number_seq"]) {
  prismaExecuteOrFail(`CREATE SEQUENCE IF NOT EXISTS ${seq};`, seq);
}
// 20260919100000_document_sequences declares its CHECK inside CREATE TABLE IF NOT EXISTS; `db push`
// has already created the table without it, so replaying that file would be a no-op. Add it directly
// (check-schema-drift lists it as protected and reported it MISSING on a --reset database).
prismaExecuteOrFail(
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_sequences_value_positive') THEN
       ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_value_positive" CHECK ("value" > 0);
     END IF;
   END $$;`,
  "document_sequences_value_positive",
);

/**
 * ③b Replay the invariant migrations in full. The statement allowlist above deliberately skips
 * functions/triggers/EXCLUDE/CHECK, so a test DB built from `db push` alone had NO slot-exclusion
 * constraints and NO wallet CHECK — every double-booking and balance-consistency test passed
 * against an unconstrained database. These files are idempotent (IF NOT EXISTS / CREATE OR
 * REPLACE / DROP … IF EXISTS before ADD) and are executed whole so `$$` function bodies survive.
 * `__tests__/db-invariants.test.ts` asserts the result.
 */
/**
 * ③b-pre Repair residue the completed-booking CHECK would refuse — test database only.
 *
 * Until 20260921140000 the test database had no `booking_completed_requires_timestamp`, so fixtures
 * could leave COMPLETED bookings with no completion time and nothing objected. A persistent local
 * test database accumulates such rows from interrupted runs (12 were found on 2026-09-21: 8 from
 * admin-booking-integrity, 4 from booking-consistency, both since corrected to set `completedAt`),
 * and `ADD CONSTRAINT` refuses while any exist. CI starts empty and never hits this. Backfilling the
 * timestamp from `updated_at` on the isolated test database is the honest repair: the rows are
 * fixture residue, the database is disposable, and the alternative — adding the CHECK `NOT VALID` —
 * would make the test database's definition differ from live and from a fresh build.
 */
console.log("③b-pre repair COMPLETED-without-completed_at residue (isolated test database only)");
prismaExecuteOrFail(
  `UPDATE "bookings" SET "completed_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
   WHERE "status"::text = 'COMPLETED' AND "completed_at" IS NULL;`,
  "completed_at residue repair",
);

console.log("③b replay invariant migrations (EXCLUDE constraints, slot trigger, wallet CHECK, partial index)");
const INVARIANT_MIGRATIONS = [
  // The rupee→paise dual-write triggers + money_to_paise(). Application code sets both columns
  // explicitly, so these are a backstop rather than the primary path — but a test database whose
  // money tables behave differently from production is not a place to certify money behaviour.
  "20260609280000_money_paise_full_dual_write",
  "20260609240000_booking_slot_exclusion_wallet_atomic",
  "20260909090000_booking_slot_half_open_ranges",
  "20260825170000_wallet_txn_bonus_consistency",
  "20260916090000_consumer_idempotency",
  "20260916100000_notification_dedup_widen",
  // The completed-booking CHECK. Until this file existed the constraint lived only on the live
  // database: fixtures that set `completedAt` "because the CHECK requires it" were passing against
  // a test database that had no such CHECK.
  "20260921140000_live_only_check_and_column_alignment",
  // Service domain: the customer taxonomy ROWS (13 categories / 13 subcategories), the taxonomy and
  // service_code triggers and the identity / range CHECKs. Rows are data, which db push never
  // creates — without this replay a --reset test DB has an empty taxonomy and every
  // taxonomy assertion runs against nothing. Both files are idempotent.
  "20260921150000_service_identity_taxonomy",
  "20260921160000_service_addon_dependencies",
];
for (const dir of INVARIANT_MIGRATIONS) {
  let sql = "";
  try {
    sql = readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");
  } catch {
    console.error(`   ❌ missing ${dir}/migration.sql`);
    process.exit(1);
  }
  const r = prismaExecute(sql);
  if (r.status === 0) {
    applied++;
    console.log(`   replayed ${dir}`);
  } else {
    /**
     * A failure here is reported but no longer fatal, because this replay is best-effort by nature
     * and step ⑦ is the authority on whether the invariants actually exist.
     *
     * The list is chronological, so it replays SUPERSEDED definitions too. `20260609240000` builds
     * the slot EXCLUDE constraints over CLOSED ranges ('[]'), which `20260909090000` later replaces
     * with half-open ones ('[)') precisely because the closed version makes back-to-back bookings
     * impossible. Run against a database that already holds legitimate back-to-back bookings, the
     * older statement fails on its own superseded rule — and `process.exit(1)` here left the
     * database with its slot columns already dropped by `db push` and nothing to replace them,
     * which is strictly worse than carrying on.
     *
     * Step ⑦ derives the objects from the migrations with later DROPs honoured, so it establishes
     * the CURRENT definition and exits non-zero if anything is genuinely absent.
     */
    const err = `${r.stderr ?? ""} ${r.stdout ?? ""}`.trim().split("\n").pop();
    console.warn(`   ⚠ ${dir}: ${err}`);
    console.warn(`     continuing — step ⑦ verifies the current definition of every invariant`);
  }
}
const partialIdx = prismaExecute(
  "CREATE INDEX IF NOT EXISTS idx_addresses_payload_hash ON addresses(address_payload_hash) WHERE address_payload_hash IS NOT NULL;",
);
if (partialIdx.status !== 0) {
  console.error(`   ❌ idx_addresses_payload_hash: ${(partialIdx.stderr ?? "").trim().split("\n").pop()}`);
  process.exit(1);
}
const invariantProbe = prismaExecute(
  "DO $$ BEGIN IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('bookings_provider_slot_excl','bookings_user_slot_excl','wallet_balance_consistency')) <> 3 THEN RAISE EXCEPTION 'invariant constraints missing after replay'; END IF; END $$;",
);
if (invariantProbe.status !== 0) {
  console.error(`   ❌ invariant probe failed: ${(invariantProbe.stderr ?? "").trim().split("\n").pop()}`);
  process.exit(1);
}
console.log("   ✅ invariant constraints present");

// Fixtures here are created and deleted by design. The financial-history delete guard
// (migration 20260920090000) stays ON everywhere else; on this disposable database only, the
// deliberate opt-out is the database default. TEST_DB is a constant ("homigo_test").
const purge = prismaExecute(`ALTER DATABASE ${TEST_DB} SET homigo.allow_financial_purge = 'on';`);
if (purge.status !== 0) {
  console.error(`   ❌ financial purge default: ${(purge.stderr ?? "").trim().split("\n").pop()}`);
  process.exit(1);
}
console.log("   ✅ financial-history guard opted out on the test database only");

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
  { object: "partner_presence", dir: "20260907120000_partner_presence_foundation" },
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

/**
 * Every database-enforced invariant the migrations declare, whether or not anyone remembered to add
 * its migration to INVARIANT_MIGRATIONS above.
 *
 * That list is hand-written, and a hand-written list is missing the next entry by default. It was
 * missing nineteen: wallet-balance-non-negative on users AND providers, reserved-balance-non-negative,
 * payment-amount-positive, rating-range, the double-booking guard, and the partial unique indexes
 * behind one-PRODUCTION-model-version and one-active-authority-rank. Suites certifying that the
 * DATABASE refuses bad money were running against a database with no such rule — and a test asserting
 * a refusal that cannot happen does not fail loudly, it just stops meaning anything.
 *
 * The checker derives the set from the migrations themselves and honours later DROPs, so the gap
 * cannot be reintroduced by forgetting to update a list.
 */
finish(applied);

/** ⑦ invariants, the sequence probe and ⑨ schema drift — the authority on both build paths. */
function finish(applied: number): never {
  console.log("⑦ database-enforced invariants declared in migrations but not expressible in schema.prisma");
  const invariants = spawnSync("bun", ["run", join(import.meta.dir, "check-test-db-invariants.ts"), "--apply"], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (invariants.status !== 0) {
    console.error("   ❌ could not establish the declared invariants in the test database");
    process.exit(1);
  }

  // `db execute` exits 0 even for an empty SELECT, so assert existence with a statement that FAILS
  // when any numbering sequence is missing (nextval on a missing relation → 42P01).
  const seq = prismaExecute(
    "SELECT nextval('journal_entry_number_seq') + nextval('wallet_txn_number_seq') + nextval('withdrawal_number_seq');",
  );
  const seqOk = (seq.stdout ?? "").includes("1") || seq.status === 0;

  /**
   * ⑨ The same protected-object check the live DB gets. A fresh (--reset / CI) database used to be
   * missing wallet_txn_number_seq and a CHECK constraint while setup printed ✅; now any protected
   * object the migrations declare but this script failed to create fails the setup.
   */
  const drift = spawnSync("bun", ["run", join(import.meta.dir, "check-schema-drift.ts")], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, DATABASE_URL: TEST_URL },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const driftOk = drift.status === 0;
  if (!driftOk) console.error(`   ❌ schema drift on ${TEST_DB}:\n${(drift.stdout ?? "") + (drift.stderr ?? "")}`);

  console.log(
    `\n${seqOk && driftOk ? "✅" : "❌"} test DB ready (custom SQL applied: ${applied}, sequences status=${seq.status}, schema drift ${driftOk ? "OK" : "FAILED"})`,
  );
  process.exit(seq.status === 0 && driftOk ? 0 : 1);
}
