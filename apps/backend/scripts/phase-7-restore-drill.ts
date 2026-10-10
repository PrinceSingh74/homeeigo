/**
 * Phase 7 restore drill.
 * Dump isolated homigo_test → restore into homigo_phase7_scratch → reconcile counts.
 * Never writes homigo_db or homigo_staging_db. Never prints secrets.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { requireDeclaredTarget } from "./lib/script-target";

const FORBIDDEN = new Set(["homigo_db", "homigo_staging_db", "postgres"]);
const SOURCE = requireDeclaredTarget({ label: "phase-7-restore-drill" });
if (FORBIDDEN.has(SOURCE.database) || SOURCE.live) {
  console.error(`[phase-7] REFUSING source database "${SOURCE.database}"`);
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "homigo-postgres";
const SCRATCH_NAME = process.env.PHASE7_SCRATCH_DB ?? "homigo_phase7_scratch";
const GOLD_ID = process.env.PHASE6_BOOKING_ID?.trim() ?? "cmv20qxxz00b4tzp8muuuj8d6";
const BACKUP_DIR = process.env.BACKUP_DIR ?? join("D:/homigo/apps/backend/backups");

function parseDbUrl(url: string) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL must be postgresql://user:pass@host:port/db");
  return { user: decodeURIComponent(m[1]!), password: decodeURIComponent(m[2]!), host: m[3]!, port: m[4]!, db: m[5]! };
}

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; inStream?: NodeJS.ReadableStream; outStream?: NodeJS.WritableStream } = {}) {
  return new Promise<{ code: number; stderr: string; stdout: string }>((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    if (opts.outStream) child.stdout.pipe(opts.outStream);
    else child.stdout.on("data", (d) => (stdout += d.toString()));
    if (opts.inStream) {
      child.stdin.on("error", () => undefined);
      opts.inStream.on("error", () => undefined);
      opts.inStream.pipe(child.stdin);
    }
    child.on("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err), stdout: "" }));
  });
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (c) => hash.update(c));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function dockerPsql(db: string, sql: string, creds: ReturnType<typeof parseDbUrl>) {
  return run("docker", ["exec", "-e", `PGPASSWORD=${creds.password}`, CONTAINER, "psql", "-U", creds.user, "-d", db, "-t", "-A", "-c", sql]);
}

const TABLES = ["users", "bookings", "payments", "journal_entries", "ledger_entries", "earnings", "notifications", "support_tickets"] as const;

async function counts(db: string, creds: ReturnType<typeof parseDbUrl>) {
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    const r = await dockerPsql(db, `SELECT COUNT(*) FROM "${table}"`, creds);
    if (r.code !== 0) throw new Error(`count ${table} on ${db}: ${r.stderr}`);
    out[table] = Number(r.stdout.trim() || "0");
  }
  return out;
}

function fields(line: string): string[] {
  return line.trim().split(/[|\t]/).map((s) => s.trim());
}

async function ledgerBalance(db: string, creds: ReturnType<typeof parseDbUrl>) {
  const r = await dockerPsql(db, `SELECT COALESCE(SUM(debit_paise),0)::text, COALESCE(SUM(credit_paise),0)::text FROM ledger_entries`, creds);
  if (r.code !== 0) throw new Error(`ledger ${db}: ${r.stderr}`);
  const parts = fields(r.stdout);
  return { debitPaise: parts[0] ?? "0", creditPaise: parts[1] ?? "0" };
}

async function goldRow(db: string, creds: ReturnType<typeof parseDbUrl>) {
  const r = await dockerPsql(
    db,
    `SELECT id, booking_number, status, final_amount::text, payment_status, provider_id FROM bookings WHERE id = '${GOLD_ID.replace(/'/g, "")}'`,
    creds,
  );
  if (r.code !== 0) throw new Error(`gold ${db}: ${r.stderr}`);
  const line = r.stdout.trim();
  if (!line) return null;
  const [id, bookingNumber, status, finalAmount, paymentStatus, providerId] = fields(line);
  return { id, bookingNumber, status, finalAmount, paymentStatus, providerId };
}

if (FORBIDDEN.has(SCRATCH_NAME) || /staging|homigo_db$/i.test(SCRATCH_NAME) || !/scratch|phase7/i.test(SCRATCH_NAME)) {
  console.error(`[phase-7] REFUSING scratch name "${SCRATCH_NAME}"`);
  process.exit(2);
}

const creds = parseDbUrl(DATABASE_URL);
if (creds.db !== SOURCE.database) {
  console.error("[phase-7] DATABASE_URL name mismatch");
  process.exit(2);
}

await mkdir(BACKUP_DIR, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
  if (err.code !== "EEXIST") throw err;
});
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dumpFile = join(BACKUP_DIR, `homigo_test_phase7_${stamp}.dump`);
const t0 = Date.now();

console.log(`[phase-7] dump ${creds.db} via ${CONTAINER} → ${basename(dumpFile)}`);
const out = createWriteStream(dumpFile);
const dump = await run("docker", ["exec", "-e", `PGPASSWORD=${creds.password}`, CONTAINER, "pg_dump", "-U", creds.user, "-Fc", "--no-password", creds.db], { outStream: out });
await new Promise((r) => out.end(r));
if (dump.code !== 0) {
  console.error(`[phase-7] pg_dump failed: ${dump.stderr.trim()}`);
  process.exit(1);
}
const size = (await stat(dumpFile)).size;
if (size < 1024) {
  console.error(`[phase-7] dump too small: ${size}`);
  process.exit(1);
}
const checksum = await sha256File(dumpFile);
await writeFile(`${dumpFile}.sha256`, `${checksum}  ${basename(dumpFile)}\n`);
console.log(`[phase-7] dump bytes=${size} sha256=${checksum.slice(0, 16)}…`);

const sourceCounts = await counts(creds.db, creds);
const sourceLedger = await ledgerBalance(creds.db, creds);
const sourceGold = await goldRow(creds.db, creds);

const drop = await dockerPsql("postgres", `DROP DATABASE IF EXISTS "${SCRATCH_NAME}"`, creds);
if (drop.code !== 0) {
  console.error(`[phase-7] drop scratch: ${drop.stderr}`);
  process.exit(1);
}
const create = await dockerPsql("postgres", `CREATE DATABASE "${SCRATCH_NAME}"`, creds);
if (create.code !== 0) {
  console.error(`[phase-7] create scratch: ${create.stderr}`);
  process.exit(1);
}

const restore = await run(
  "docker",
  ["exec", "-i", "-e", `PGPASSWORD=${creds.password}`, CONTAINER, "pg_restore", "-U", creds.user, "-d", SCRATCH_NAME, "--no-owner", "--no-acl"],
  { inStream: createReadStream(dumpFile) },
);
// pg_restore often exits 1 for ignorable notices (extensions/ACLs). Treat empty DB as fail; otherwise accept 0/1.
const restoredCounts = await counts(SCRATCH_NAME, creds);
if (restoredCounts.users <= 0 || restoredCounts.bookings <= 0) {
  console.error(`[phase-7] restore empty: ${restore.stderr.slice(0, 400)}`);
  process.exit(1);
}

const restoredLedger = await ledgerBalance(SCRATCH_NAME, creds);
const restoredGold = await goldRow(SCRATCH_NAME, creds);
const rtoSeconds = Number(((Date.now() - t0) / 1000).toFixed(2));

const countDrift = TABLES.filter((t) => sourceCounts[t] !== restoredCounts[t]);
const ledgerOk = sourceLedger.debitPaise === restoredLedger.debitPaise && sourceLedger.creditPaise === restoredLedger.creditPaise && sourceLedger.debitPaise === sourceLedger.creditPaise;
const goldOk = Boolean(sourceGold?.id) && JSON.stringify(sourceGold) === JSON.stringify(restoredGold);

const pass = countDrift.length === 0 && ledgerOk && goldOk;
const evidence = {
  phase: 7,
  drill: "backup-restore",
  sourceDb: creds.db,
  scratchDb: SCRATCH_NAME,
  dump: basename(dumpFile),
  sizeBytes: size,
  sha256: checksum,
  rtoSeconds,
  sourceCounts,
  restoredCounts,
  countDrift,
  sourceLedger,
  restoredLedger,
  ledgerBalanced: sourceLedger.debitPaise === sourceLedger.creditPaise,
  ledgerMatch: ledgerOk,
  gold: { source: sourceGold, restored: restoredGold, match: goldOk },
  pgRestoreExit: restore.code,
  status: pass ? "PASS" : "FAIL",
  finishedAt: new Date().toISOString(),
};

await writeFile("D:/homigo/docs/phase-7-restore-evidence.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ...evidence, sha256: checksum.slice(0, 16) + "…" }, null, 2));
if (!pass) process.exit(1);
