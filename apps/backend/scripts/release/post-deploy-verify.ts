/**
 * POST-DEPLOY VERIFICATION — read-only.
 *
 * Runs immediately after `prisma migrate deploy` and answers one question per invariant, from the
 * database itself. It exists because the release plan's verification step was prose: a list of SQL
 * a human was expected to run and read correctly at the tensest moment of a deployment.
 *
 * Deliberately does NOT read application logs. A log line saying a thing started is a claim; a
 * catalog query is the state. The two disagree exactly when it matters most.
 *
 * Writes nothing. Safe to run against production at any time — before a release it reports the
 * pre-migration state, which is also how this script was tested.
 *
 *   bun --env-file=.env run scripts/release/post-deploy-verify.ts
 *
 * Exit 0 only when every invariant holds.
 */
import { PrismaClient } from "@prisma/client";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const EXPECTED_APPLIED_MIGRATIONS = 109;

type Result = { id: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (id: string, ok: boolean, detail: string) => results.push({ id, ok, detail });

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? "" } } });
const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe(sql) as Promise<T[]>;

const db = (await q<{ db: string }>("SELECT current_database() AS db"))[0]!.db;
console.log(`post-deploy verification — ${db} (read-only)\n`);

// 1. Migration ledger ---------------------------------------------------------
const mig = (
  await q<{ applied: number; rolled_back: number; total: number }>(`
    SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
           count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS rolled_back,
           count(*)::int AS total
    FROM _prisma_migrations`)
)[0]!;
check(
  "migrations",
  mig.applied >= EXPECTED_APPLIED_MIGRATIONS,
  `${mig.applied} applied (expected >= ${EXPECTED_APPLIED_MIGRATIONS}), ${mig.rolled_back} rolled back, ${mig.total} ledger rows`,
);

/**
 * Every migration this build ships is applied (2026-10-01). The count above is a fixed lower bound
 * written when the repository had 109 migrations; at 148 it can no longer fail for any of the newer
 * ones. This compares names: a migration directory in the release that the ledger does not show as
 * finished-and-not-rolled-back means `migrate deploy` did not do what the release assumes.
 */
const shipped = readdirSync(join(import.meta.dir, "..", "..", "prisma", "migrations"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const appliedNames = new Set(
  (
    await q<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    )
  ).map((r) => r.migration_name),
);
const missing = shipped.filter((name) => !appliedNames.has(name));
const unknown = [...appliedNames].filter((name) => !shipped.includes(name));
check(
  "migrations_match_release",
  missing.length === 0,
  missing.length === 0
    ? `all ${shipped.length} shipped migrations applied${unknown.length ? ` (+${unknown.length} applied but not in this release: ${unknown.slice(0, 3).join(", ")})` : ""}`
    : `${missing.length} shipped migration(s) NOT applied: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
);

// 2. Audit trace — the Phase-14 blocker ---------------------------------------
const traceIdx = await q<{ indexdef: string }>(`
  SELECT indexdef FROM pg_indexes
  WHERE tablename = 'enterprise_audit_logs' AND indexdef ILIKE '%trace_id%'`);
const stillUnique = traceIdx.some((i) => /CREATE UNIQUE/i.test(i.indexdef));
check(
  "audit_trace_not_unique",
  !stillUnique,
  stillUnique
    ? "trace_id is STILL uniquely indexed — one governance event per trace, the migration did not apply"
    : "trace_id is not uniquely constrained",
);

/**
 * The constraint's absence is necessary but not sufficient: what matters is whether a trace can
 * actually hold more than one event. This reads the live distribution rather than the schema.
 * Before any multi-event trace exists the maximum is legitimately 1, so this is reported as
 * evidence rather than asserted — it becomes meaningful once governed operations have run.
 */
const maxPerTrace = (
  await q<{ n: number }>(`
    SELECT COALESCE(max(c), 0)::int AS n FROM (
      SELECT count(*) AS c FROM enterprise_audit_logs WHERE trace_id IS NOT NULL GROUP BY trace_id
    ) t`)
)[0]!.n;
console.log(`  (evidence) max audit events on a single trace: ${maxPerTrace}\n`);

// 3. Booking slot ranges ------------------------------------------------------
const slot = await q<{ conname: string; def: string }>(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conname LIKE 'bookings_%slot_excl'`);
const halfOpen = slot.length > 0 && slot.every((c) => c.def.includes("'[)'"));
check(
  "booking_slot_half_open",
  halfOpen,
  slot.length === 0
    ? "no slot exclusion constraints found"
    : `${slot.length} constraint(s), half-open: ${halfOpen}`,
);

// 4. Tables the release must create -------------------------------------------
const REQUIRED_TABLES = [
  "ml_model_versions",
  "ml_shadow_predictions",
  "ai_budget_policies",
  "ai_budget_windows",
  "ai_workflow_drafts",
  "knowledge_documents",
  "knowledge_chunks",
  "knowledge_authority_rules",
  "support_ai_recommendations",
];
const present = new Set(
  (
    await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
  ).map((r) => r.table_name),
);
const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));
check(
  "release_tables",
  missingTables.length === 0,
  missingTables.length === 0
    ? `all ${REQUIRED_TABLES.length} present`
    : `missing: ${missingTables.join(", ")}`,
);

// 5. ML registry shape --------------------------------------------------------
if (present.has("ml_model_versions")) {
  const stages = await q<{ enumlabel: string }>(`
    SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.oid = (SELECT atttypid FROM pg_attribute
                   WHERE attrelid = 'ml_model_versions'::regclass AND attname = 'stage')`);
  const labels = stages.map((s) => s.enumlabel);
  const REQUIRED_STAGES = ["CANDIDATE", "SHADOW", "APPROVED", "PRODUCTION", "ROLLED_BACK", "RETIRED"];
  const missingStages = REQUIRED_STAGES.filter((s) => !labels.includes(s));
  check(
    "ml_lifecycle",
    missingStages.length === 0,
    missingStages.length === 0 ? `${labels.length} stages incl. rollback` : `missing stages: ${missingStages.join(", ")}`,
  );
} else {
  check("ml_lifecycle", false, "ml_model_versions absent");
}

// 6. Budget accounting shape --------------------------------------------------
if (present.has("ai_budget_windows")) {
  const cols = (
    await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_budget_windows'`,
    )
  ).map((c) => c.column_name);
  const REQUIRED_COLS = ["reserved_usd", "settled_usd", "unknown_cost_requests"];
  const missingCols = REQUIRED_COLS.filter((c) => !cols.includes(c));
  check(
    "ai_budget_shape",
    missingCols.length === 0,
    missingCols.length === 0
      ? "reserve/settle accounting with explicit unknown-cost column"
      : `missing columns: ${missingCols.join(", ")}`,
  );
} else {
  check("ai_budget_shape", false, "ai_budget_windows absent");
}

/**
 * Phase-15 capabilities fail closed, so a missing flag row means the capability is OFF. That is the
 * correct state immediately after a deploy — this reports what is there rather than demanding rows,
 * because demanding an enabled flag here would push toward enabling capabilities to satisfy a check.
 */
const flags = await q<{ key: string; enabled: boolean; environment: string; rollout_pct: number }>(
  `SELECT key, enabled, environment, rollout_pct FROM platform_feature_flags ORDER BY key`,
);
const p15 = flags.filter((f) => f.key.startsWith("PHASE15_"));
console.log(`  (evidence) feature flags: ${flags.length} total, ${p15.length} Phase-15`);
for (const f of p15) {
  console.log(`             ${f.enabled ? "ON " : "OFF"} ${String(f.rollout_pct).padStart(3)}% ${f.environment} ${f.key}`);
}
if (p15.some((f) => f.enabled)) {
  console.log("             NOTE: a Phase-15 capability is already enabled — intended only after canary\n");
} else {
  console.log("");
}

// 7. Data contamination boundary ----------------------------------------------
const fixtures = (
  await q<{ n: number }>(`
    SELECT count(*)::int AS n FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE s.name LIKE 'Adv Service adv-%'`)
)[0]!.n;
const realBookings = (
  await q<{ n: number }>(`
    SELECT count(*)::int AS n FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE s.name NOT LIKE 'Adv Service adv-%'`)
)[0]!.n;
console.log(
  `  (evidence) fixture bookings: ${fixtures} of ${fixtures + realBookings} ` +
    `(${((fixtures / Math.max(1, fixtures + realBookings)) * 100).toFixed(0)}%) — ` +
    "unresolved until an authorized reconciliation\n",
);

// ── report ────────────────────────────────────────────────────────────────────
for (const r of results) {
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log("");
if (failed.length > 0) {
  console.log(`POST_DEPLOY_VERIFICATION_FAILED — ${failed.length} invariant(s): ${failed.map((f) => f.id).join(", ")}`);
  console.log("Stop the rollout. Do not enable feature flags against a schema that failed verification.");
  await prisma.$disconnect();
  process.exit(1);
}
console.log("POST_DEPLOY_VERIFICATION_PASSED — every schema invariant holds.");
console.log("Next: create production feature flags DISABLED, then canary one capability.");
await prisma.$disconnect();
