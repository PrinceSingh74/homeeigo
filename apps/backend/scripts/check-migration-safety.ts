/**
 * Migration safety guard.
 *
 * ── The incident this exists to prevent ──────────────────────────────────────
 *
 * `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`
 * on this repository produces roughly 300 lines, only a fraction of which are the objects the
 * author intended to add. The rest is accumulated drift between migration history and the schema
 * file, and it is destructive. Observed output includes:
 *
 *     ALTER TABLE "bookings" DROP COLUMN "provider_slot_end", DROP COLUMN "provider_slot_start",
 *                            DROP COLUMN "user_slot_end",     DROP COLUMN "user_slot_start";
 *     DROP INDEX "users_email_key";
 *     DROP INDEX "providers_pan_number_key";
 *     ALTER TABLE "knowledge_chunks" DROP COLUMN "search_vector";
 *
 * Those four booking columns back the half-open-range exclusion constraint added in
 * `20260909090000_booking_slot_half_open_ranges`. Dropping them silently re-opens the
 * double-booking defect that migration was written to close — a customer and a partner could be
 * committed to the same slot twice, with no error anywhere.
 *
 * An engineer who generates that diff and commits it has done the normal, documented thing. The
 * failure is entirely non-obvious at review time, because the dangerous lines are buried among
 * hundreds of legitimate ones. So the check has to be mechanical.
 *
 * ── What this guard does and does not do ─────────────────────────────────────
 *
 * It does NOT try to decide whether a migration is "good". It refuses one specific, mechanically
 * detectable class: a DROP against an object on the protected list. Everything else passes.
 *
 * It is deliberately NOT solved by ignoring migration diffs. The diff is the right tool; the
 * problem is that its output must be reviewed against a list a human cannot hold in their head.
 *
 * Usage:
 *   bun run scripts/check-migration-safety.ts                  # scan all migrations
 *   bun run scripts/check-migration-safety.ts path/to.sql      # scan one file
 *   MIGRATION_SAFETY_OVERRIDE="<reason>" bun run ...           # explicit, recorded override
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";

type Protection = {
  id: string;
  /** Why this object must not be dropped, in terms of what breaks. */
  reason: string;
  /** Matched case-insensitively against the identifier in a DROP statement. */
  objects: string[];
};

/**
 * The protected set.
 *
 * Each entry names objects whose loss is silent — the system keeps running and starts being
 * wrong. Objects whose loss is loud (a table the code selects from every request) do not need to
 * be here; the application fails immediately and somebody notices.
 */
const PROTECTED: Protection[] = [
  {
    id: "BOOKING_SLOT_EXCLUSION",
    reason:
      "These columns back the half-open-range exclusion constraint that makes double-booking impossible. Dropping them re-opens the defect silently: bookings simply start overlapping again, with no error.",
    objects: [
      "provider_slot_start",
      "provider_slot_end",
      "user_slot_start",
      "user_slot_end",
      "bookings_provider_slot_excl",
      "bookings_user_slot_excl",
      // The trigger + function populate the slot columns; without them both EXCLUDE constraints
      // are inert (NULL ranges never conflict). btree_gist is what the `provider_id WITH =` operand needs.
      "bookings_conflict_slots_trg",
      "bookings_sync_conflict_slots",
      "btree_gist",
    ],
  },
  {
    id: "RAW_SQL_INVARIANTS",
    reason:
      "Objects that exist only in migration SQL, never in schema.prisma, so every `prisma migrate diff` proposes dropping them. Each one is a correctness invariant the application silently relies on: the wallet CHECK is the last line against a wrong closing balance, the search_vector generated column backs knowledge retrieval, the partial index backs address dedup.",
    objects: [
      "wallet_balance_consistency",
      // A COMPLETED booking must carry completed_at; earnings/payout/settlement read it. Lived only on
      // the live database until 20260921140000 — a rebuild had no such guard.
      "booking_completed_requires_timestamp",
      "search_vector",
      "knowledge_chunks_search_vector_idx",
      "idx_addresses_payload_hash",
      // Consumer idempotency arbiters (20260916090000_consumer_idempotency): without them a redelivered
      // event schedules a second review request / stages a second ML row / re-notifies a partner.
      "scheduled_jobs_review_request_trigger_event_id_key",
      "ml_feature_staging_event_id_key",
      "notifications_partner_referral_dedup_key",
      "notifications_booking_accepted_dedup_key",
    ],
  },
  {
    id: "UNIQUE_IDENTITY",
    reason:
      "Unique indexes on identity columns are what stop duplicate accounts and duplicate partner registrations. Dropping one does not fail anything at write time — it just lets the duplicates in.",
    objects: [
      "users_email_key",
      "users_phone_key",
      "users_phone_number_key",
      "users_email_hash_key",
      "users_phone_hash_key",
      "providers_pan_number_key",
      "providers_aadhar_number_key",
    ],
  },
  {
    id: "FINANCE_LEDGER",
    reason:
      "The ledger is the authoritative record of money. A dropped column or constraint here is unrecoverable after the fact — there is no second copy to reconstruct it from.",
    objects: [
      "ledger_entries",
      "ledger_accounts",
      "journal_entries",
      "financial_transactions",
      "wallet_transactions",
      "payment_settlements",
      "refund_requests",
    ],
  },
  {
    id: "AUDIT_TRAIL",
    reason:
      "Audit rows are the only record of who did what. Losing them does not break a request path, so nothing surfaces — the platform simply stops being able to answer questions about its own past.",
    objects: [
      "enterprise_audit_logs",
      "activity_logs",
      "ai_tool_executions",
      "ai_tool_approvals",
      "ai_tool_policy_logs",
      "agent_runs",
      "agent_run_steps",
    ],
  },
  {
    id: "GOVERNANCE",
    reason:
      "Feature flags, approvals and policy rows are the controls that decide what may execute. Dropping one fails OPEN in the worst cases — a missing flag row is read as disabled, but a missing flag TABLE is a lookup error on every call.",
    objects: [
      "platform_feature_flags",
      "platform_feature_flag_history",
      "ai_budget_policies",
      "ai_prompt_templates",
      "ai_tool_registry",
    ],
  },
  {
    id: "WORKFLOW_EVENTS",
    reason:
      "The outbox is the transactional boundary for every event in the platform. Dropping it or its status column turns guaranteed delivery into best-effort, silently.",
    objects: [
      "event_outbox",
      "scheduled_jobs",
      "workflow_instances",
      "workflow_definitions",
      "event_dead_letters",
    ],
  },
  {
    id: "ML_REGISTRY",
    reason:
      "Model registry rows are what tie a prediction to the model version that made it. Without them, past inferences become unattributable and model governance claims become unverifiable.",
    objects: ["ml_model_registry", "ml_model_versions", "ml_shadow_evaluations"],
  },
];

type Finding = {
  file: string;
  line: number;
  statement: string;
  protection: Protection;
  matched: string;
};

/**
 * Extract DROP-shaped operations.
 *
 * Deliberately matches the three forms that actually appear in Prisma output — `DROP TABLE`,
 * `DROP INDEX`, and `DROP COLUMN` inside an ALTER — plus `DROP CONSTRAINT`. Statements are
 * flattened first because Prisma emits multi-column drops across several lines, and a
 * line-by-line scan would see `DROP COLUMN "provider_slot_end",` on one line and miss the rest.
 */
function findDrops(sql: string): Array<{ line: number; statement: string }> {
  const out: Array<{ line: number; statement: string }> = [];
  const lines = sql.split(/\r?\n/);

  let buffer = "";
  let startLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const withoutComment = raw.replace(/--.*$/, "");
    if (withoutComment.trim().length === 0) continue;
    if (buffer.length === 0) startLine = i + 1;
    buffer += ` ${withoutComment.trim()}`;
    if (!withoutComment.includes(";")) continue;

    const statement = buffer.trim();
    buffer = "";
    if (
      /\bDROP\s+(TABLE|INDEX|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|EXTENSION)\b/i.test(statement) ||
      // Renaming a protected object is a drop as far as every reader of the old name is concerned.
      /\bRENAME\s+(COLUMN\s+)?["'`]?[A-Za-z0-9_.]+["'`]?\s+TO\b/i.test(statement) ||
      /\bALTER\s+(INDEX|TABLE)\s+[^;]*\bRENAME\s+TO\b/i.test(statement) ||
      // Loosening a column is a drop of its guarantee: NOT NULL / DEFAULT removal on a protected column.
      /\bALTER\s+COLUMN\s+"?[A-Za-z0-9_]+"?\s+DROP\s+(NOT\s+NULL|DEFAULT)\b/i.test(statement)
    ) {
      out.push({ line: startLine, statement });
    }
  }
  // A trailing statement with no terminating semicolon still counts.
  if (buffer.trim().length > 0 && /\bDROP\s+(TABLE|INDEX|COLUMN|CONSTRAINT)\b/i.test(buffer)) {
    out.push({ line: startLine, statement: buffer.trim() });
  }
  return out;
}

/**
 * Is this object put back by the same migration?
 *
 * A DROP followed by a CREATE or ADD of the same name is a REPLACEMENT, not a removal — the
 * object exists on both sides of the migration and nothing is lost. This is not a hypothetical:
 * `20260909090000_booking_slot_half_open_ranges` drops both booking exclusion constraints
 * precisely so it can recreate them with half-open ranges, which is the migration that FIXED the
 * double-booking defect this guard exists to protect.
 *
 * Without this the guard would refuse the very migration it is defending, and the only way to
 * ship would be to override it — which teaches everyone to override it by reflex, and the next
 * genuine drop sails through.
 *
 * Scoped to the same file deliberately. "Some later migration recreates it" is not the same
 * guarantee: between the two, the constraint is absent and overlapping rows can be committed.
 */
function isRecreatedInSameFile(sql: string, objectName: string): boolean {
  const lower = sql.toLowerCase();
  const name = objectName.toLowerCase();
  const recreate = new RegExp(
    `(add\\s+constraint|create\\s+(unique\\s+)?index(\\s+concurrently)?(\\s+if\\s+not\\s+exists)?|create\\s+table(\\s+if\\s+not\\s+exists)?|add\\s+column(\\s+if\\s+not\\s+exists)?)[^;]*["'\`\\s.(]${name}["'\`\\s,);]`,
    "s",
  );
  return recreate.test(lower);
}

/**
 * The identifiers a statement actually DROPS.
 *
 * This is the correction that makes the guard usable. Matching any protected name appearing
 * anywhere in a DROP statement flags
 *
 *     ALTER TABLE "wallet_transactions" DROP CONSTRAINT "wallet_balance_consistency";
 *
 * as "dropping wallet_transactions", which is simply false — the table is the SUBJECT, the
 * constraint is the object. A guard that reports things that are not happening gets overridden by
 * reflex, and then the real one goes through with it.
 *
 * So only the name following each DROP keyword is considered.
 */
export function droppedIdentifiers(statement: string): string[] {
  const names: string[] = [];
  // An optional schema qualifier (public."x", "public"."x") is consumed and discarded so the
  // captured name is the object, not the schema — `DROP INDEX public."users_email_key"` used to
  // yield "public" and sail through.
  const Q = `(?:["'\`]?[A-Za-z0-9_]+["'\`]?\\.)?["'\`]?([A-Za-z0-9_]+)["'\`]?`;
  const re = new RegExp(
    `\\bDROP\\s+(?:TABLE|INDEX|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|EXTENSION)\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?${Q}`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(statement)) !== null) names.push(m[1]!.toLowerCase());
  // RENAME COLUMN "old" TO "new"  /  ALTER INDEX "old" RENAME TO "new"  /  ALTER TABLE "old" RENAME TO "new"
  const renameCol = new RegExp(`\\bRENAME\\s+COLUMN\\s+${Q}\\s+TO\\b`, "gi");
  while ((m = renameCol.exec(statement)) !== null) names.push(m[1]!.toLowerCase());
  const renameObj = new RegExp(`\\bALTER\\s+(?:INDEX|TABLE)\\s+(?:IF\\s+EXISTS\\s+)?${Q}\\s+RENAME\\s+TO\\b`, "gi");
  while ((m = renameObj.exec(statement)) !== null) names.push(m[1]!.toLowerCase());
  // `ALTER COLUMN "x" DROP NOT NULL|DEFAULT` — the guarantee on x is what is being dropped.
  const loosen = /\bALTER\s+COLUMN\s+["'`]?([A-Za-z0-9_]+)["'`]?\s+DROP\s+(?:NOT\s+NULL|DEFAULT)\b/gi;
  while ((m = loosen.exec(statement)) !== null) names.push(m[1]!.toLowerCase());

  // Prisma emits multi-column drops as `DROP COLUMN "a", DROP COLUMN "b"` — already handled by
  // the global regex — but also as a bare continuation `..., DROP COLUMN "b"` across lines, which
  // the statement flattening above joins back together, so both forms are covered.
  return names;
}

/**
 * In-file override: `-- ALLOW_DESTRUCTIVE: <reason of at least 20 characters>` anywhere in the
 * migration. Unlike the env var it is code-reviewed and stays with the migration forever. Read from
 * the raw text — `findDrops` strips comments before scanning.
 */
export function inlineOverride(sql: string): string | null {
  const m = sql.match(/--\s*ALLOW_DESTRUCTIVE:\s*(.+)/i);
  const reason = m?.[1]?.trim() ?? "";
  return reason.length >= 20 ? reason : null;
}

/**
 * Row-destroying statements.
 *
 * ── Why this is a SEPARATE class from a dropped object ───────────────────────
 *
 * The protected-object list answers "did this migration remove a structure the application relies
 * on". It says nothing about rows. On 2026-09-16 a migration whose DELETE collapsed "duplicates"
 * removed 3,939 historical `scheduled_jobs` rows, and this guard passed it — correctly, by its own
 * rules, because no protected OBJECT was dropped. That is the gap.
 *
 * Deleting rows in a migration is sometimes necessary (you cannot add a unique index over existing
 * duplicates without collapsing them first). It is never something to do without having said so:
 * the uniqueness assumption behind the DELETE is exactly what was wrong in that incident, and a
 * wrong assumption is invisible until the rows are gone. So this does not ban row deletion — it
 * requires the author to state it, in the file, where review can see it.
 */
const DATA_LOSS_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "DELETE", re: /\bDELETE\s+FROM\b/i },
  { kind: "TRUNCATE", re: /\bTRUNCATE\b/i },
  /**
   * `UPDATE t SET c = <literal>` with no WHERE overwrites every existing value with a constant —
   * the old values are gone. A backfill (`SET paise = money_to_paise(amount)`) is the opposite: it
   * DERIVES a new column from one that is still there, which is how every dual-write migration in
   * this repository populates its `*_paise` columns, and flagging those would train people to add
   * the waiver by reflex. So this matches only a constant assignment.
   */
  {
    kind: "UNSCOPED OVERWRITE",
    re: /\bUPDATE\s+[^;]*\bSET\b\s+"?[A-Za-z0-9_]+"?\s*=\s*('[^']*'|\d+(?:\.\d+)?|true|false|null|DEFAULT)\s*(?:;|$)(?![^;]*\bWHERE\b)/i,
  },
];

export function findDataLoss(sql: string): Array<{ line: number; statement: string; kind: string }> {
  const out: Array<{ line: number; statement: string; kind: string }> = [];
  const lines = sql.split(/\r?\n/);
  let buffer = "";
  let startLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const withoutComment = (lines[i] ?? "").replace(/--.*$/, "");
    if (withoutComment.trim().length === 0) continue;
    if (buffer.length === 0) startLine = i + 1;
    buffer += ` ${withoutComment.trim()}`;
    if (!withoutComment.includes(";")) continue;
    const statement = buffer.trim();
    buffer = "";
    for (const { kind, re } of DATA_LOSS_PATTERNS) {
      if (re.test(statement)) {
        out.push({ line: startLine, statement, kind });
        break;
      }
    }
  }
  return out;
}

/**
 * `-- ALLOW_DATA_LOSS: <reason>` — the author's statement of what is being removed and why it is
 * safe. Separate from ALLOW_DESTRUCTIVE (schema) on purpose: the two risks are different, and a
 * blanket waiver for one must not silently cover the other.
 */
export function dataLossDeclaration(sql: string): string | null {
  const m = sql.match(/--\s*ALLOW_DATA_LOSS:\s*(.+)/i);
  const reason = m?.[1]?.trim() ?? "";
  return reason.length >= 20 ? reason : null;
}

const DATA_LOSS_PROTECTION: Protection = {
  id: "ROW_DELETION",
  reason:
    "This migration deletes or rewrites rows. That is sometimes required (collapsing duplicates before a unique index), but the uniqueness assumption behind it is exactly the kind of thing that is wrong silently — on 2026-09-16 a DELETE of this shape removed 3,939 rows of job history because the key it deduplicated on was wrong for one job type. State the assumption in the file so review can check it.",
  objects: [],
};

export function scan(file: string, sql: string): Finding[] {
  const findings: Finding[] = [];
  for (const { line, statement } of findDrops(sql)) {
    const dropped = droppedIdentifiers(statement);
    if (dropped.length === 0) continue;

    for (const protection of PROTECTED) {
      for (const obj of protection.objects) {
        const name = obj.toLowerCase();
        if (!dropped.includes(name)) continue;
        if (isRecreatedInSameFile(sql, obj)) continue;
        findings.push({ file, line, statement, protection, matched: obj });
      }
    }
  }

  // Row deletion is its own finding class, waived by its own declaration.
  if (!dataLossDeclaration(sql)) {
    for (const { line, statement, kind } of findDataLoss(sql)) {
      findings.push({
        file,
        line,
        statement,
        protection: DATA_LOSS_PROTECTION,
        matched: kind,
      });
    }
  }

  return findings;
}

/**
 * Which migrations is this run responsible for?
 *
 * By default: only migrations that are NEW — untracked, or added relative to the git baseline.
 *
 * That scoping is the difference between a guard and a nuisance. The repository contains genuine
 * historical drops that were correct when written: `20260609180000_p4_encryption_audit` drops
 * `users_email_key` because it replaces plain unique indexes with hash-based ones
 * (`users_email_hash_key`), and `20260529114745_part_6a_realtime_tracking` does the same for the
 * provider identity columns. Those are already deployed. Failing every build forever over
 * migrations that shipped months ago does not protect anything — it just guarantees the guard is
 * disabled or overridden by reflex, and then the next genuine drop goes through with it.
 *
 * The job is to stop a dangerous migration from being AUTHORED. `--all` audits the full history
 * when someone actually wants that.
 */
function newMigrationFiles(root: string): string[] | null {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    const run = (cmd: string) =>
      execSync(cmd, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });

    const untracked = run("git ls-files --others --exclude-standard -- prisma/migrations")
      .split(/\r?\n/)
      .filter((l) => l.trim().endsWith(".sql"));
    // In CI the working tree is clean, so "changed vs HEAD" is empty by construction. The workflow
    // passes the base ref (PR base sha / pre-push sha) so the branch's commits are what get scanned.
    const base = process.env.MIGRATION_SAFETY_BASE?.trim();
    const diffRef = base && /^[0-9a-f]{7,40}$/i.test(base) ? `${base}...HEAD` : "HEAD";
    const changed = run(`git diff --name-only --diff-filter=AM ${diffRef} -- prisma/migrations`)
      .split(/\r?\n/)
      .filter((l) => l.trim().endsWith(".sql"));

    return [...new Set([...untracked, ...changed])].map((rel) => join(root, rel.trim()));
  } catch {
    // No git, or not a repository. Returning null makes the caller fall back to the full scan,
    // which is the safe direction: check everything rather than silently check nothing.
    return null;
  }
}

function allSqlFiles(root: string): string[] {
  const dir = join(root, "prisma/migrations");
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry);
    if (!statSync(sub).isDirectory()) continue;
    for (const f of readdirSync(sub)) {
      if (f.endsWith(".sql")) files.push(join(sub, f));
    }
  }
  return files;
}

function collectSqlFiles(target?: string): { files: string[]; scope: string } {
  const root = resolve(import.meta.dir, "..");

  if (target && target !== "--all") {
    const p = resolve(target);
    if (!existsSync(p)) throw new Error(`No such file: ${p}`);
    if (statSync(p).isFile()) return { files: [p], scope: target };
  }

  if (target === "--all") {
    return { files: allSqlFiles(root), scope: "ALL migrations (full history audit)" };
  }

  const fresh = newMigrationFiles(root);
  if (fresh === null) {
    return { files: allSqlFiles(root), scope: "ALL migrations (git unavailable; failing safe)" };
  }
  return {
    files: fresh.filter((f) => existsSync(f)),
    scope: `${fresh.length} new/modified migration file(s)`,
  };
}

function main(): void {
  const target = process.argv[2];
  const { files, scope } = collectSqlFiles(target);

  if (files.length === 0) {
    console.log(`[migration-safety] OK — no new migration SQL to check (${scope})`);
    process.exit(0);
  }

  const findings: Finding[] = [];
  const inlineOverrides: string[] = [];
  for (const file of files) {
    const sql = readFileSync(file, "utf-8");
    const fileFindings = scan(file, sql);
    if (fileFindings.length === 0) continue;
    const reason = inlineOverride(sql);
    if (reason) {
      // Reviewed, in-file, permanent. Recorded on stdout so the CI log carries it.
      inlineOverrides.push(`${file.replace(resolve(import.meta.dir, ".."), "")}: ${reason}`);
      continue;
    }
    findings.push(...fileFindings);
  }
  for (const o of inlineOverrides) console.log(`[migration-safety] ALLOW_DESTRUCTIVE accepted — ${o}`);

  if (findings.length === 0) {
    console.log(`[migration-safety] OK — ${scope} scanned, no protected object is dropped`);
    process.exit(0);
  }

  console.error(`\n${"=".repeat(78)}`);
  console.error(`MIGRATION SAFETY: ${findings.length} DANGEROUS OPERATION(S) DETECTED`);
  console.error("=".repeat(78));

  const byProtection = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byProtection.get(f.protection.id) ?? [];
    list.push(f);
    byProtection.set(f.protection.id, list);
  }

  for (const [id, group] of byProtection) {
    console.error(`\n[${id}]`);
    console.error(`  ${group[0]!.protection.reason}`);
    for (const f of group) {
      const rel = f.file.replace(resolve(import.meta.dir, ".."), "");
      console.error(`\n  ${rel}:${f.line}`);
      console.error(`    drops: ${f.matched}`);
      console.error(`    ${f.statement.slice(0, 200)}`);
    }
  }

  const override = process.env.MIGRATION_SAFETY_OVERRIDE;
  if (override && override.trim().length >= 20) {
    console.error(`\n${"=".repeat(78)}`);
    console.error("OVERRIDE ACCEPTED — this is recorded, not waived:");
    console.error(`  ${override}`);
    console.error("=".repeat(78));
    process.exit(0);
  }

  console.error(`\n${"=".repeat(78)}`);
  console.error("REFUSING.");
  console.error("");
  console.error("If this migration was generated by `prisma migrate diff`, it almost certainly");
  console.error("contains accumulated drift you did not intend. The fix is to hand-scope the");
  console.error("migration to the objects you actually meant to change, NOT to override this.");
  console.error("");
  console.error("If the drop IS intended, put a reviewed explanation of at least 20 characters IN the migration:");
  console.error("  -- ALLOW_DESTRUCTIVE: why this drop is correct and what replaces it");
  console.error("(MIGRATION_SAFETY_OVERRIDE=<reason> still works for a one-off local run.)");
  console.error("=".repeat(78));
  process.exit(1);
}

if (import.meta.main) main();
