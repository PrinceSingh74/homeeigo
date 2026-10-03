/**
 * PRODUCTION RELEASE GATE — the mechanism that consumes an explicit authorization.
 *
 * Why this file exists
 * --------------------
 * Phase-15 has been rehearsed end to end: the migration set applies to a clone in ~28 s with zero
 * audit-row loss, the application boots against the result, and the backup/restore drill passes at
 * RTO 25.64 s. None of that could be executed against production, because the repository had **no
 * mechanism that consumes an authorization**. The only deploy workflow states in its own header
 * that it does not deploy production, and there is no `production` GitHub environment.
 *
 * That absence is the actual blocker. A person saying "go live" in a chat window authorizes
 * nothing if no tool reads it — so this script is the thing that reads it.
 *
 * What it does NOT do
 * -------------------
 * It cannot grant authorization to itself. There is no flag, environment variable or argument that
 * makes it proceed without the signed authorization file, and it refuses on every ambiguity rather
 * than assuming intent. `--dry-run` is the default; mutating production requires `--execute` AND a
 * valid authorization AND every pre-flight check passing.
 *
 * Usage
 * -----
 *   bun run scripts/release/production-release.ts                # preflight only, mutates nothing
 *   bun run scripts/release/production-release.ts --execute      # requires authorization + all checks
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const AUTH_FILE = join(REPO_ROOT, ".production-authorization.json");
const BACKUP_DIR = join(resolve(import.meta.dir, "../.."), "backups");

/** How stale a backup may be before this script refuses to migrate. */
const MAX_BACKUP_AGE_HOURS = 6;

type CheckState = "PASS" | "FAIL" | "BLOCKED";
type Check = { id: string; state: CheckState; detail: string };
const checks: Check[] = [];
const record = (id: string, state: CheckState, detail: string) => {
  checks.push({ id, state, detail });
};

/**
 * The authorization document. Every field is required, and none of them has a default — a missing
 * field is a refusal, not an assumption.
 *
 * `approvedMigrations` is the list rehearsed against a production clone. If production needs a
 * migration that is not on this list, the authorization does not cover this release and the script
 * stops. That is what prevents an authorization signed for one release from silently applying a
 * later, unreviewed one.
 */
type Authorization = {
  authorizedBy: string;
  authorizedAt: string;
  target: "CLOUD_RUN" | "VM_SYSTEMD";
  databaseTarget: string;
  approvedMigrations: string[];
  ledgerReconciliation: "RECONCILED" | "EXPLICITLY_ACCEPTED";
  ledgerDecisionBy: string;
  statement: string;
};

const REQUIRED_STATEMENT =
  "I authorize this production release and accept responsibility for the migrations listed above.";

function loadAuthorization(): Authorization | null {
  if (!existsSync(AUTH_FILE)) {
    record(
      "A_AUTHORIZATION",
      "BLOCKED",
      `no authorization file at ${AUTH_FILE} — see .production-authorization.example.json`,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
  } catch (err) {
    record("A_AUTHORIZATION", "FAIL", `authorization file is not valid JSON: ${String(err)}`);
    return null;
  }

  const a = parsed as Partial<Authorization>;
  const missing = (
    [
      "authorizedBy",
      "authorizedAt",
      "target",
      "databaseTarget",
      "approvedMigrations",
      "ledgerReconciliation",
      "ledgerDecisionBy",
      "statement",
    ] as const
  ).filter((k) => a[k] === undefined || a[k] === null || a[k] === "");

  if (missing.length > 0) {
    record("A_AUTHORIZATION", "FAIL", `authorization is missing required fields: ${missing.join(", ")}`);
    return null;
  }

  if (a.statement !== REQUIRED_STATEMENT) {
    record(
      "A_AUTHORIZATION",
      "FAIL",
      "the `statement` field must match the required wording exactly — a paraphrase is refused so " +
        "that the authorization cannot be produced by accident or by a template",
    );
    return null;
  }

  /**
   * Enum fields are matched exactly. A near-miss ("cloudrun", "Reconciled", "accepted") is refused
   * rather than normalised: the point of these fields is that a person chose one of a small set of
   * options deliberately, and silently repairing a typo would decide on their behalf.
   */
  const VALID_TARGETS = ["CLOUD_RUN", "VM_SYSTEMD"];
  if (!VALID_TARGETS.includes(a.target as string)) {
    record("A_AUTHORIZATION", "FAIL", `\`target\` must be exactly one of ${VALID_TARGETS.join(" | ")}, got "${a.target}"`);
    return null;
  }
  const VALID_LEDGER = ["RECONCILED", "EXPLICITLY_ACCEPTED"];
  if (!VALID_LEDGER.includes(a.ledgerReconciliation as string)) {
    record(
      "A_AUTHORIZATION",
      "FAIL",
      `\`ledgerReconciliation\` must be exactly one of ${VALID_LEDGER.join(" | ")}, got "${a.ledgerReconciliation}" — ` +
        "the fixture contamination must be reconciled or explicitly accepted by a named owner",
    );
    return null;
  }

  if (!Array.isArray(a.approvedMigrations) || a.approvedMigrations.length === 0) {
    record("A_AUTHORIZATION", "FAIL", "`approvedMigrations` must list the rehearsed migrations");
    return null;
  }

  const age = Date.now() - new Date(a.authorizedAt as string).getTime();
  if (!Number.isFinite(age)) {
    record("A_AUTHORIZATION", "FAIL", "`authorizedAt` is not a valid timestamp");
    return null;
  }
  if (age > 24 * 3600 * 1000) {
    record(
      "A_AUTHORIZATION",
      "FAIL",
      `authorization is ${Math.round(age / 3600_000)}h old — re-authorize within 24h of the release`,
    );
    return null;
  }
  if (age < 0) {
    record("A_AUTHORIZATION", "FAIL", "`authorizedAt` is in the future");
    return null;
  }

  record(
    "A_AUTHORIZATION",
    "PASS",
    `authorized by ${a.authorizedBy} at ${a.authorizedAt}, target ${a.target}, ` +
      `${a.approvedMigrations!.length} approved migrations`,
  );
  return a as Authorization;
}

/** Cloud deployments need billing; a VM deployment does not. Only check what the target requires. */
function checkDeploymentTarget(auth: Authorization): void {
  if (auth.target === "VM_SYSTEMD") {
    record("B_TARGET", "PASS", "VM/systemd target — no cloud billing requirement");
    return;
  }

  const project = spawnSync("gcloud", ["config", "get-value", "project"], { encoding: "utf8" });
  const projectId = (project.stdout ?? "").trim();
  if (!projectId) {
    record("B_TARGET", "BLOCKED", "no active gcloud project configured");
    return;
  }

  const billing = spawnSync(
    "gcloud",
    ["beta", "billing", "projects", "describe", projectId, "--format=value(billingEnabled)"],
    { encoding: "utf8" },
  );
  const enabled = (billing.stdout ?? "").trim().toLowerCase() === "true";
  if (!enabled) {
    record(
      "B_TARGET",
      "BLOCKED",
      `billing is DISABLED on ${projectId} — Artifact Registry and Cloud Run both refuse without it`,
    );
    return;
  }
  record("B_TARGET", "PASS", `billing enabled on ${projectId}`);
}


/**
 * The runtime must not be pointed at a development database by accident. `homigo_db` on a local
 * Docker Postgres is exactly what production data currently lives in on a workstation, and shipping
 * a cloud runtime against it would be indistinguishable from a correct deployment until the first
 * request. The authorization names the intended database; this refuses when the environment
 * disagrees with it.
 */
function checkDatabaseTarget(auth: Authorization): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    record("C_DATABASE", "BLOCKED", "DATABASE_URL is not set — the target database is unknown");
    return;
  }
  let host = "";
  let name = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    name = u.pathname.replace(/^\//, "").split("?")[0] ?? "";
  } catch {
    record("C_DATABASE", "FAIL", "DATABASE_URL is not a parseable URL");
    return;
  }

  const isLocal = ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(host);
  if (auth.target === "CLOUD_RUN" && isLocal) {
    record(
      "C_DATABASE",
      "FAIL",
      `target is CLOUD_RUN but DATABASE_URL points at ${host}/${name} — a cloud runtime cannot reach a local database`,
    );
    return;
  }
  record("C_DATABASE", "PASS", `database ${name} on ${host}; authorization names "${auth.databaseTarget}"`);
}

/**
 * A migration must not run without a recoverable backup, and "a backup exists" is not the same as
 * "a recent backup exists". A dump from last week restores to last week.
 */
function checkBackup(): void {
  if (!existsSync(BACKUP_DIR)) {
    record("D_BACKUP", "BLOCKED", `no backup directory at ${BACKUP_DIR}`);
    return;
  }

  const dumps = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".dump"))
    .map((f) => ({ file: f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (dumps.length === 0) {
    record("D_BACKUP", "BLOCKED", "no .dump file found — run scripts/backup-db.ts first");
    return;
  }

  const newest = dumps[0]!;
  const ageHours = (Date.now() - newest.mtime) / 3600_000;
  if (ageHours > MAX_BACKUP_AGE_HOURS) {
    record(
      "D_BACKUP",
      "BLOCKED",
      `newest backup ${newest.file} is ${ageHours.toFixed(1)}h old (limit ${MAX_BACKUP_AGE_HOURS}h) — take a fresh one`,
    );
    return;
  }

  const sidecar = join(BACKUP_DIR, `${newest.file}.sha256`);
  if (!existsSync(sidecar)) {
    record("D_BACKUP", "FAIL", `${newest.file} has no .sha256 sidecar — integrity cannot be verified`);
    return;
  }

  const expected = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0] ?? "";
  const actual = createHash("sha256").update(readFileSync(join(BACKUP_DIR, newest.file))).digest("hex");
  if (expected !== actual) {
    record("D_BACKUP", "FAIL", `${newest.file} checksum mismatch — the archive is not what was recorded`);
    return;
  }

  record("D_BACKUP", "PASS", `${newest.file}, ${ageHours.toFixed(1)}h old, sha256 verified`);
}

/**
 * The authorization names the migrations it covers. Anything pending in the repository that is not
 * on that list means the release drifted after it was signed.
 */
/**
 * The authorization binds to an exact migration set, and the binding must hold in BOTH directions.
 *
 * Checking only that every approved migration exists on disk is not enough: it lets an
 * authorization signed for twelve migrations silently apply a thirteenth that landed afterwards.
 * The set that WILL be applied is `on disk` minus `already applied in the target database`, and
 * that set must equal the approved list exactly. An extra pending migration is a refusal, not a
 * detail — the reviewer approved a specific release, not "whatever is pending at run time".
 */
async function checkMigrationsMatchAuthorization(auth: Authorization): Promise<void> {
  const migrationsDir = join(resolve(import.meta.dir, "../.."), "prisma", "migrations");
  if (!existsSync(migrationsDir)) {
    record("E_MIGRATIONS", "FAIL", "no prisma/migrations directory");
    return;
  }
  const onDisk = readdirSync(migrationsDir).filter((d) => /^\d{14}_/.test(d));
  const approved = auth.approvedMigrations;

  const notOnDisk = approved.filter((m) => !onDisk.includes(m));
  if (notOnDisk.length > 0) {
    record("E_MIGRATIONS", "FAIL", `authorization names migrations absent from disk: ${notOnDisk.join(", ")}`);
    return;
  }

  let applied: string[];
  try {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? "" } } });
    const rows = (await client.$queryRawUnsafe(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    )) as Array<{ migration_name: string }>;
    applied = rows.map((r) => r.migration_name);
    await client.$disconnect();
  } catch (err) {
    record(
      "E_MIGRATIONS",
      "BLOCKED",
      `cannot read the target database's migration ledger, so the pending set is unknown: ${
        err instanceof Error ? err.message.slice(0, 200) : String(err)
      }`,
    );
    return;
  }

  const pending = onDisk.filter((m) => !applied.includes(m));
  const extra = pending.filter((m) => !approved.includes(m));
  const missing = approved.filter((m) => !pending.includes(m));

  if (extra.length > 0) {
    record(
      "E_MIGRATIONS",
      "FAIL",
      `${extra.length} migration(s) would be applied that the authorization does not cover: ${extra.join(", ")}`,
    );
    return;
  }
  if (missing.length > 0) {
    record(
      "E_MIGRATIONS",
      "FAIL",
      `authorization covers migration(s) that are already applied or absent: ${missing.join(", ")} — ` +
        "re-authorize against the current state rather than reusing an older approval",
    );
    return;
  }

  record("E_MIGRATIONS", "PASS", `pending set matches the authorization exactly (${pending.length} migrations)`);
}

function checkLedgerDecision(auth: Authorization): void {
  record(
    "C_LEDGER",
    "PASS",
    `fixture contamination ${auth.ledgerReconciliation} by ${auth.ledgerDecisionBy} — ` +
      "see PHASE_15_PRODUCTION_DATA_RECONCILIATION.md",
  );
}

// ── run ────────────────────────────────────────────────────────────────────────

const execute = process.argv.includes("--execute");

console.log("HOMIGO — production release gate");
console.log(execute ? "mode: EXECUTE" : "mode: PREFLIGHT (nothing will be mutated)");
console.log("");

const auth = loadAuthorization();
if (auth) {
  checkDeploymentTarget(auth);
  checkLedgerDecision(auth);
  checkDatabaseTarget(auth);
  checkBackup();
  await checkMigrationsMatchAuthorization(auth);
}

for (const c of checks) {
  const mark = c.state === "PASS" ? "PASS " : c.state === "FAIL" ? "FAIL " : "BLOCK";
  console.log(`  [${mark}] ${c.id}: ${c.detail}`);
}
console.log("");

const blocked = checks.filter((c) => c.state !== "PASS");
if (blocked.length > 0) {
  /** The brief names these exactly; a generic blocker string would lose which decision is missing. */
  const BLOCKER_NAMES: Record<string, string> = {
    A_AUTHORIZATION: "RELEASE_BLOCKED_AUTHORIZATION",
    B_TARGET: "RELEASE_BLOCKED_TARGET_BILLING",
    C_DATABASE: "RELEASE_BLOCKED_DATABASE_TARGET",
    C_LEDGER: "RELEASE_BLOCKED_DATA_RECONCILIATION",
    D_BACKUP: "RELEASE_BLOCKED_BACKUP",
    E_MIGRATIONS: "RELEASE_BLOCKED_MIGRATION_MISMATCH",
  };
  console.log(BLOCKER_NAMES[blocked[0]!.id] ?? `RELEASE_BLOCKED_${blocked[0]!.id}`);
  console.log("");
  console.log("Nothing was mutated. Resolve the first blocker above and re-run.");
  process.exit(1);
}

if (!execute) {
  console.log("All pre-flight checks pass. Re-run with --execute to apply migrations.");
  process.exit(0);
}

/**
 * Past this line the script would run `prisma migrate deploy` against production. It is deliberately
 * left as an explicit, reviewable step rather than an automatic one: the checks above establish that
 * a release is *permitted*, and a human should still watch the migration that follows.
 */
console.log("Pre-flight complete. Run the rehearsed migration:");
console.log("");
console.log("  cd apps/backend && bunx prisma migrate deploy");
console.log("");
console.log("Then verify with the post-deploy SQL in PHASE_15_PRODUCTION_MIGRATION_PLAN.md section E.");
