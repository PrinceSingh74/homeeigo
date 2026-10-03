/**
 * Phase 16 — migration safety guard self-test (§52).
 *
 * A guard that has never been observed failing is not a guard. This deliberately generates
 * dangerous migrations, asserts the guard REFUSES each one, then asserts it accepts a safe one —
 * so the pass is evidence rather than an assumption.
 *
 * The dangerous fixtures are written to a temporary directory and deleted afterwards. They are
 * never placed in `prisma/migrations`, because a destructive migration sitting in that directory
 * is one `migrate deploy` away from being real regardless of what this script intends.
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const ROOT = resolve(import.meta.dir, "../..");
const GUARD = join(ROOT, "scripts/check-migration-safety.ts");

type Case = {
  id: string;
  name: string;
  sql: string;
  /** true when the guard must REFUSE (exit non-zero). */
  mustRefuse: boolean;
  env?: Record<string, string>;
};

const CASES: Case[] = [
  {
    id: "MG1",
    name: "The real prisma migrate diff output — drops the booking slot columns",
    // Taken verbatim from the diff this repository actually generates.
    sql: `
-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "provider_slot_end",
DROP COLUMN "provider_slot_start",
DROP COLUMN "user_slot_end",
DROP COLUMN "user_slot_start";
`,
    mustRefuse: true,
  },
  {
    id: "MG2",
    name: "Dropping a unique identity index",
    sql: `DROP INDEX "users_email_key";`,
    mustRefuse: true,
  },
  {
    id: "MG3",
    name: "Dropping the transactional outbox",
    sql: `DROP TABLE "event_outbox";`,
    mustRefuse: true,
  },
  {
    id: "MG4",
    name: "Dropping an audit table",
    sql: `DROP TABLE IF EXISTS "enterprise_audit_logs";`,
    mustRefuse: true,
  },
  {
    id: "MG5",
    name: "Dropping the agent run history",
    sql: `DROP TABLE "agent_run_steps";`,
    mustRefuse: true,
  },
  {
    id: "MG6",
    name: "Dropping a ledger table",
    sql: `DROP TABLE "ledger_entries";`,
    mustRefuse: true,
  },
  {
    id: "MG7",
    name: "Dropping the booking exclusion constraint without recreating it",
    sql: `ALTER TABLE "bookings" DROP CONSTRAINT "bookings_provider_slot_excl";`,
    mustRefuse: true,
  },
  {
    id: "MG8",
    name: "Drop-and-RECREATE of the same constraint is a replacement, not a loss",
    sql: `
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_provider_slot_excl";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_slot_excl"
  EXCLUDE USING gist ("provider_id" WITH =, tstzrange("provider_slot_start", "provider_slot_end", '[)') WITH &&);
`,
    mustRefuse: false,
  },
  {
    id: "MG9",
    name: "An ordinary additive migration passes",
    sql: `
CREATE TABLE "some_new_feature" ("id" TEXT NOT NULL, CONSTRAINT "some_new_feature_pkey" PRIMARY KEY ("id"));
CREATE INDEX "some_new_feature_id_idx" ON "some_new_feature"("id");
`,
    mustRefuse: false,
  },
  {
    id: "MG10",
    name: "Dropping an UNPROTECTED table is allowed — the guard is narrow, not a blanket ban",
    sql: `DROP TABLE "temporary_import_staging";`,
    mustRefuse: false,
  },
  {
    id: "MG11",
    name: "A protected table named as the ALTER subject is NOT a drop of that table",
    // The false positive that made the first version of the guard unusable.
    sql: `ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "some_unprotected_check";`,
    mustRefuse: false,
  },
  {
    id: "MG12",
    name: "A short override is refused; the reason must be substantive",
    sql: `DROP TABLE "event_outbox";`,
    mustRefuse: true,
    env: { MIGRATION_SAFETY_OVERRIDE: "yes" },
  },
  {
    id: "MG13",
    name: "An explicit, substantive override is accepted and recorded",
    sql: `DROP TABLE "event_outbox";`,
    mustRefuse: false,
    env: {
      MIGRATION_SAFETY_OVERRIDE:
        "Outbox replaced by the partitioned event_outbox_v2 in the same release; data migrated and verified.",
    },
  },
];

const results: Array<{ id: string; name: string; ok: boolean; detail: string }> = [];

function run(): void {
  const dir = mkdtempSync(join(tmpdir(), "phase16-migguard-"));
  try {
    for (const c of CASES) {
      const file = join(dir, `${c.id}.sql`);
      writeFileSync(file, c.sql);

      const out = spawnSync("bun", ["run", GUARD, file], {
        cwd: ROOT,
        encoding: "utf-8",
        env: { ...process.env, ...(c.env ?? {}) },
        timeout: 60_000,
      });

      const refused = out.status !== 0;
      const ok = refused === c.mustRefuse;
      results.push({
        id: c.id,
        name: c.name,
        ok,
        detail: `expected=${c.mustRefuse ? "REFUSE" : "ACCEPT"} actual=${refused ? "REFUSE" : "ACCEPT"} exit=${out.status}`,
      });
      console.log(`[${ok ? "PASS" : "FAIL"}] ${c.id} ${c.name}\n        ${results[results.length - 1]!.detail}`);
    }
  } finally {
    // Always removed. A directory of destructive migrations left behind is a hazard in itself.
    rmSync(dir, { recursive: true, force: true });
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`MIGRATION GUARD SELF-TEST: ${pass} PASS, ${fail} FAIL (${results.length} cases)`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));
  process.exit(fail > 0 ? 1 : 0);
}

run();
