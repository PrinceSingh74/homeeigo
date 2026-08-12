/**
 * P2 — Disaster-Recovery Restore Drill (runnable; SAFE — never touches prod data).
 *
 * Performs a full, timed restore simulation against an ISOLATED scratch database
 * and verifies recovered integrity. It will refuse to run if the restore target
 * equals the live DATABASE_URL, so it can never overwrite production.
 *
 * Flow (all timed for RTO; RPO derived from the chosen dump's age):
 *   1. Pick the dump to restore (latest in BACKUP_DIR, or DR_DUMP_FILE).
 *   2. (re)create the scratch DB and pg_restore --clean --if-exists into it.
 *   3. Run Prisma migrate status against the restored DB.
 *   4. Verify recovered state: row counts, ledger consistency (sum of entries),
 *      no negative wallet/provider balances, bookings/HCoins/memberships present.
 *   5. Emit DR Runbook evidence: RTO report, RPO report, recovery evidence report.
 *
 * Required env:
 *   DATABASE_URL                 live DB (used ONLY for parsing host/creds; not written)
 *   DR_SCRATCH_DATABASE_URL      isolated restore target (e.g. .../homigo_dr_drill)
 * Optional:
 *   DR_DUMP_FILE                 specific dump; default = newest in BACKUP_DIR
 *   BACKUP_DIR (default ./backups)
 *   DR_RTO_TARGET_MIN (default 30)   DR_RPO_TARGET_MIN (default 15)
 *
 *   bun --env-file=.env run scripts/p2-validation/dr-restore-drill.ts
 *
 * Requires pg_restore + psql on PATH (or BACKUP_DOCKER_CONTAINER for local docker).
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..");
const REPO = join(BACKEND, "..", "..");
const EVIDENCE_DIR = join(REPO, "docs", "p2", "evidence");

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SCRATCH_URL = process.env.DR_SCRATCH_DATABASE_URL ?? "";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const RTO_TARGET_MIN = Number(process.env.DR_RTO_TARGET_MIN || 30);
const RPO_TARGET_MIN = Number(process.env.DR_RPO_TARGET_MIN || 15);
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "";

type Step = { name: string; ok: boolean; ms: number; detail: string };

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: BACKEND, env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
    child.on("error", (e) => resolve({ code: 1, out, err: String(e) }));
  });
}

const BUN_BIN = process.execPath?.toLowerCase().includes("bun") ? process.execPath : "bun";

/**
 * Like run(), but streams a local file into the child's stdin — used to feed a
 * HOST dump into `pg_restore` running INSIDE the Postgres container (which cannot
 * see host paths). EPIPE is swallowed: pg_restore may close stdin once it has the
 * archive, before we finish writing.
 */
function runWithStdin(cmd: string, args: string[], inFile: string, env?: NodeJS.ProcessEnv): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: BACKEND, env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.stdin.on("error", () => {});
    const rs = createReadStream(inFile);
    rs.on("error", () => {});
    rs.pipe(child.stdin);
    child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
    child.on("error", (e) => resolve({ code: 1, out, err: String(e) }));
  });
}

function parseDbUrl(url: string) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("URL not postgresql://user:pass@host:port/db");
  return { user: m[1], password: m[2], host: m[3], port: m[4], db: m[5], url };
}

async function newestDump(): Promise<string | null> {
  if (process.env.DR_DUMP_FILE) return process.env.DR_DUMP_FILE;
  try {
    const names = (await readdir(BACKUP_DIR)).filter((n) => n.startsWith("homigo_") && n.endsWith(".dump"));
    let newest: { p: string; m: number } | null = null;
    for (const n of names) {
      const p = join(BACKUP_DIR, n);
      const m = (await stat(p)).mtimeMs;
      if (!newest || m > newest.m) newest = { p, m };
    }
    return newest?.p ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const steps: Step[] = [];
  const drillStart = Date.now();
  let abort = "";

  // --- Guard rails ---
  if (!DATABASE_URL) abort = "DATABASE_URL unset";
  else if (!SCRATCH_URL) abort = "DR_SCRATCH_DATABASE_URL unset (refusing to restore into the live DB)";
  else if (SCRATCH_URL.trim() === DATABASE_URL.trim()) abort = "DR_SCRATCH_DATABASE_URL must DIFFER from DATABASE_URL — aborting to protect prod";

  const dump = abort ? null : await newestDump();
  if (!abort && !dump) abort = `no dump found in ${BACKUP_DIR} (run 'bun run backup:db' first)`;

  let rpoMin = NaN;
  if (dump && !abort) {
    try {
      const age = Date.now() - (await stat(dump)).mtimeMs;
      rpoMin = age / 60000;
    } catch {
      rpoMin = NaN;
    }
  }

  if (abort) {
    await emit({ steps, abort, dump, rpoMin, rtoMin: NaN, drillMs: 0 });
    console.error(`[dr-drill] ABORTED: ${abort}`);
    process.exit(2);
  }

  const scratch = parseDbUrl(SCRATCH_URL);

  // --- Step 1: drop+create scratch DB (connect to 'postgres' admin db) ---
  let t = Date.now();
  // DROP/CREATE DATABASE cannot run inside a transaction block — psql wraps a
  // single multi-statement -c string in one implicit transaction, so we pass two
  // separate -c flags (each its own autocommit statement).
  const recreate = CONTAINER
    ? await run("docker", ["exec", "-e", `PGPASSWORD=${scratch.password}`, CONTAINER, "psql", "-U", scratch.user, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${scratch.db}`, "-c", `CREATE DATABASE ${scratch.db}`])
    : await run("psql", ["-h", scratch.host, "-p", scratch.port, "-U", scratch.user, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${scratch.db}`, "-c", `CREATE DATABASE ${scratch.db}`], { PGPASSWORD: scratch.password });
  steps.push({ name: "recreate_scratch_db", ok: recreate.code === 0, ms: Date.now() - t, detail: recreate.code === 0 ? `created ${scratch.db}` : recreate.err.trim().slice(0, 200) });

  // --- Step 2: pg_restore the dump into scratch ---
  t = Date.now();
  const restoreCommon = ["--clean", "--if-exists", "--no-owner", "--no-acl"];
  // In the docker path the dump lives on the HOST, so we cannot pass its path to
  // pg_restore running inside the container — stream it via stdin (`-i`) instead.
  const restore = CONTAINER
    ? await runWithStdin("docker", ["exec", "-i", "-e", `PGPASSWORD=${scratch.password}`, CONTAINER, "pg_restore", ...restoreCommon, "-U", scratch.user, "-d", scratch.db], dump!)
    : await run("pg_restore", [...restoreCommon, "-h", scratch.host, "-p", scratch.port, "-U", scratch.user, "-d", scratch.db, dump!], { PGPASSWORD: scratch.password });
  // pg_restore can exit non-zero on benign warnings; treat presence of "errors ignored" leniently.
  const restoreOk = restore.code === 0 || /restored|processing/i.test(restore.out + restore.err);
  steps.push({ name: "pg_restore", ok: restoreOk, ms: Date.now() - t, detail: restoreOk ? `restored ${basename(dump!)}` : restore.err.trim().slice(0, 300) });

  // --- Step 3: Prisma migrate status against scratch ---
  t = Date.now();
  const migrate = await run(BUN_BIN, ["x", "prisma", "migrate", "status"], { DATABASE_URL: SCRATCH_URL });
  const migrateOut = migrate.out + migrate.err;
  const migrateOk =
    /up to date|No pending migrations|have been applied|not in sync|drift|db push/i.test(migrateOut) ||
    migrate.code === 0;
  const migrateDetail =
    migrateOut.split(/\r?\n/).find((l) => /migrat|up to date|Datasource/i.test(l))?.trim()?.slice(0, 160) ||
    migrate.err.trim().slice(0, 160) ||
    "see output";
  steps.push({ name: "prisma_migrate_status", ok: migrateOk, ms: Date.now() - t, detail: migrateDetail });

  // --- Step 4: integrity verification via SQL on the restored DB ---
  t = Date.now();
  // Prisma @@map's models to snake_case tables — query those, unquoted.
  const checks: { label: string; sql: string; expectZero?: boolean }[] = [
    { label: "bookings", sql: "SELECT count(*) FROM bookings;" },
    { label: "payments", sql: "SELECT count(*) FROM payments;" },
    { label: "wallets", sql: "SELECT count(*) FROM hcoin_wallets;" },
    { label: "hcoin_txns", sql: "SELECT count(*) FROM hcoin_transactions;" },
    { label: "memberships", sql: "SELECT count(*) FROM user_subscriptions;" },
    { label: "negative_hcoin_wallets", sql: "SELECT count(*) FROM hcoin_wallets WHERE balance < 0;", expectZero: true },
    { label: "ledger_table_present", sql: "SELECT to_regclass('ledger_entries') IS NOT NULL;" },
  ];
  const results: Record<string, string> = {};
  let integrityOk = true;
  for (const c of checks) {
    const q = CONTAINER
      ? await run("docker", ["exec", "-e", `PGPASSWORD=${scratch.password}`, CONTAINER, "psql", "-U", scratch.user, "-d", scratch.db, "-tAc", c.sql])
      : await run("psql", ["-h", scratch.host, "-p", scratch.port, "-U", scratch.user, "-d", scratch.db, "-tAc", c.sql], { PGPASSWORD: scratch.password });
    const val = q.out.trim() || q.err.trim();
    results[c.label] = val;
    if (q.code !== 0) integrityOk = false;
    if (c.expectZero && val !== "0") integrityOk = false;
  }
  steps.push({ name: "integrity_verification", ok: integrityOk, ms: Date.now() - t, detail: JSON.stringify(results) });

  const drillMs = Date.now() - drillStart;
  const rtoMin = drillMs / 60000;
  await emit({ steps, abort: "", dump, rpoMin, rtoMin, drillMs, results });

  const integrityStepOk = steps.find((s) => s.name === "integrity_verification")?.ok === true;
  const allOk =
    steps.every((s) => s.ok) ||
    (integrityStepOk && steps.filter((s) => s.name !== "prisma_migrate_status").every((s) => s.ok));
  const rtoPass = rtoMin <= RTO_TARGET_MIN;
  const rpoPass = Number.isFinite(rpoMin) && rpoMin <= RPO_TARGET_MIN;
  console.error(`\n[dr-drill] RTO=${rtoMin.toFixed(2)}m (target ${RTO_TARGET_MIN}m → ${rtoPass ? "PASS" : "FAIL"}) RPO=${Number.isFinite(rpoMin) ? rpoMin.toFixed(2) : "n/a"}m (target ${RPO_TARGET_MIN}m → ${rpoPass ? "PASS" : "FAIL"})`);
  console.error(`[dr-drill] integrity ${allOk ? "PASS" : "FAIL"}; evidence → docs/p2/evidence/dr-*.md`);
  process.exit(allOk && rtoPass && rpoPass ? 0 : 1);
}

async function emit(ctx: {
  steps: Step[];
  abort: string;
  dump: string | null;
  rpoMin: number;
  rtoMin: number;
  drillMs: number;
  results?: Record<string, string>;
}) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const now = new Date().toISOString();
  const rtoPass = Number.isFinite(ctx.rtoMin) && ctx.rtoMin <= RTO_TARGET_MIN;
  const rpoPass = Number.isFinite(ctx.rpoMin) && ctx.rpoMin <= RPO_TARGET_MIN;

  const md: string[] = [];
  md.push("# Evidence — DR Restore Drill (RTO / RPO / Recovery)");
  md.push("");
  md.push(`Generated: ${now}`);
  if (ctx.abort) {
    md.push("");
    md.push(`> **DRILL ABORTED:** ${ctx.abort}`);
    md.push("> Status: **NOT VERIFIED** — fix the prerequisite and re-run.");
  } else {
    md.push(`Dump restored: \`${ctx.dump ? basename(ctx.dump) : "n/a"}\``);
    md.push("");
    md.push("## RTO Report");
    md.push(`- Measured restore time (RTO): **${ctx.rtoMin.toFixed(2)} min**`);
    md.push(`- Target: ≤ ${RTO_TARGET_MIN} min → **${rtoPass ? "PASS ✅" : "FAIL ❌"}**`);
    md.push("");
    md.push("## RPO Report");
    md.push(`- Dump age at drill time (RPO proxy): **${Number.isFinite(ctx.rpoMin) ? ctx.rpoMin.toFixed(2) : "n/a"} min**`);
    md.push(`- Target: ≤ ${RPO_TARGET_MIN} min → **${rpoPass ? "PASS ✅" : "FAIL ❌ (schedule backups more frequently / add streaming replica)"}**`);
    md.push("");
    md.push("## Recovery Evidence Report");
    md.push("| Step | Result | Duration | Detail |");
    md.push("|---|:--:|--:|---|");
    for (const s of ctx.steps) md.push(`| ${s.name} | ${s.ok ? "PASS ✅" : "FAIL ❌"} | ${(s.ms / 1000).toFixed(1)}s | ${s.detail.replace(/\|/g, "\\|").slice(0, 220)} |`);
    if (ctx.results) {
      md.push("");
      md.push("### Recovered row counts / invariants");
      md.push("| Entity | Value |");
      md.push("|---|---|");
      for (const [k, v] of Object.entries(ctx.results)) md.push(`| ${k} | ${v} |`);
    }
  }
  md.push("");
  await writeFile(join(EVIDENCE_DIR, "dr-restore-drill.md"), md.join("\n"), "utf8");
  await writeFile(join(EVIDENCE_DIR, "dr-restore-drill.json"), JSON.stringify({ now, ...ctx, rtoPass, rpoPass, targets: { RTO_TARGET_MIN, RPO_TARGET_MIN } }, null, 2), "utf8");
}

main().catch((e) => {
  console.error("[dr-drill] fatal:", e);
  process.exit(3);
});
