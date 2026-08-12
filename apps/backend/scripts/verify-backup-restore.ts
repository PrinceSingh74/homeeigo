/**
 * Backup restore verification — safe scratch-DB drill.
 *
 * Verifies a pg_dump archive end-to-end without touching production data:
 *   1. SHA256 checksum verification (if sidecar present)
 *   2. pg_restore --list integrity check
 *   3. Restore into an isolated scratch database
 *   4. Row-count verification (users, bookings)
 *
 * Required env:
 *   DATABASE_URL              live DB (credentials/host only — not written)
 *   DR_SCRATCH_DATABASE_URL   isolated restore target
 *
 * Optional:
 *   BACKUP_DIR, BACKUP_DOCKER_CONTAINER, VERIFY_DUMP_FILE
 *
 * Usage:
 *   bun --env-file=.env run scripts/verify-backup-restore.ts
 *   bun --env-file=.env run scripts/verify-backup-restore.ts ./backups/homigo_2026-06-25T11-10-42-927Z.dump
 */
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { verifyChecksum, verifyArchiveIntegrity } from "./lib/backup-retention";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SCRATCH_URL = process.env.DR_SCRATCH_DATABASE_URL ?? "";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "";
const dumpArg = process.argv[2] ?? process.env.VERIFY_DUMP_FILE ?? "";

function parseDbUrl(url: string) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL must be postgresql://user:pass@host:port/db");
  return { user: m[1], password: m[2], host: m[3], port: m[4], db: m[5] };
}

function run(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; inStream?: NodeJS.ReadableStream } = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", (d) => (stdout += d.toString()));
    if (opts.inStream) {
      child.stdin.on("error", () => {});
      opts.inStream.on("error", () => {});
      opts.inStream.pipe(child.stdin);
    }
    child.on("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err), stdout: "" }));
  });
}

async function pickLatestDump(): Promise<string> {
  const names = (await readdir(BACKUP_DIR)).filter((n) => n.startsWith("homigo_") && n.endsWith(".dump"));
  let newest: { path: string; mtime: number } | null = null;
  for (const name of names) {
    const path = join(BACKUP_DIR, name);
    const st = await stat(path);
    if (!newest || st.mtimeMs > newest.mtime) newest = { path, mtime: st.mtimeMs };
  }
  if (!newest) throw new Error(`no dump found in ${BACKUP_DIR}`);
  return newest.path;
}

async function countRows(
  db: ReturnType<typeof parseDbUrl>,
  database: string,
): Promise<{ users: number; bookings: number }> {
  const sql = (table: string) => `SELECT COUNT(*) FROM "${table}"`;
  const exec = async (q: string) => {
    const result = CONTAINER
      ? await run("docker", ["exec", CONTAINER, "psql", "-U", db.user, "-d", database, "-t", "-A", "-c", q], {
          env: { PGPASSWORD: db.password },
        })
      : await run("psql", ["-h", db.host, "-p", db.port, "-U", db.user, "-d", database, "-t", "-A", "-c", q], {
          env: { PGPASSWORD: db.password },
        });
    if (result.code !== 0) throw new Error(result.stderr || "count query failed");
    return Number(result.stdout.trim() || "0");
  };
  return { users: await exec(sql("users")), bookings: await exec(sql("bookings")) };
}

async function recreateScratchDb(live: ReturnType<typeof parseDbUrl>, scratchDb: string): Promise<void> {
  const dropSql = `DROP DATABASE IF EXISTS "${scratchDb}";`;
  const createSql = `CREATE DATABASE "${scratchDb}";`;
  for (const sql of [dropSql, createSql]) {
    const r = CONTAINER
      ? await run("docker", ["exec", CONTAINER, "psql", "-U", live.user, "-d", "postgres", "-c", sql], {
          env: { PGPASSWORD: live.password },
        })
      : await run("psql", ["-h", live.host, "-p", live.port, "-U", live.user, "-d", "postgres", "-c", sql], {
          env: { PGPASSWORD: live.password },
        });
    if (r.code !== 0) throw new Error(`scratch DB setup failed: ${r.stderr}`);
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!SCRATCH_URL) {
    console.error("DR_SCRATCH_DATABASE_URL is required (isolated restore target)");
    process.exit(1);
  }
  if (SCRATCH_URL === DATABASE_URL) {
    console.error("DR_SCRATCH_DATABASE_URL must differ from DATABASE_URL");
    process.exit(1);
  }

  const live = parseDbUrl(DATABASE_URL);
  const scratch = parseDbUrl(SCRATCH_URL);
  const dumpFile = dumpArg
    ? dumpArg.includes(":\\") || dumpArg.startsWith("/")
      ? dumpArg
      : join(BACKUP_DIR, dumpArg)
    : await pickLatestDump();

  const st = await stat(dumpFile).catch(() => null);
  if (!st?.isFile()) {
    console.error(`Backup not found: ${dumpFile}`);
    process.exit(1);
  }

  console.log(`[verify-restore] dump=${dumpFile}`);
  console.log(`[verify-restore] scratch=${scratch.db} (live ${live.db} untouched)`);

  const t0 = Date.now();
  const cs = await verifyChecksum(dumpFile);
  if (!cs.ok) {
    console.error("[verify-restore] ❌ SHA256 checksum mismatch — corrupt dump");
    process.exit(1);
  }
  console.log(`[verify-restore] ✅ SHA256 verified (${cs.checksum})`);

  const integrity = await verifyArchiveIntegrity(dumpFile, CONTAINER);
  if (!integrity.verified) {
    console.error("[verify-restore] ❌ pg_restore unavailable — cannot verify archive integrity");
    process.exit(1);
  }
  if (!integrity.ok) {
    console.error("[verify-restore] ❌ pg_restore --list failed — corrupt archive");
    process.exit(1);
  }
  console.log("[verify-restore] ✅ archive integrity verified");

  await recreateScratchDb(live, scratch.db);

  const restore = CONTAINER
    ? await run(
        "docker",
        ["exec", "-i", CONTAINER, "pg_restore", "-U", live.user, "-d", scratch.db, "--clean", "--if-exists", "--no-owner"],
        { env: { PGPASSWORD: live.password }, inStream: createReadStream(dumpFile) },
      )
    : await run(
        "pg_restore",
        ["-h", live.host, "-p", live.port, "-U", live.user, "-d", scratch.db, "--clean", "--if-exists", "--no-owner", dumpFile],
        { env: { PGPASSWORD: live.password } },
      );

  if (restore.code !== 0) {
    console.error(`[verify-restore] ❌ restore failed: ${restore.stderr.trim()}`);
    process.exit(1);
  }

  const counts = await countRows(live, scratch.db);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[verify-restore] row counts users=${counts.users} bookings=${counts.bookings}`);
  console.log(`[verify-restore] RTO=${elapsedSec}s`);

  if (counts.users <= 0) {
    console.error("[verify-restore] ❌ verification failed — no users in restored DB");
    process.exit(1);
  }

  const report = {
    timestamp: new Date().toISOString(),
    dumpFile,
    scratchDb: scratch.db,
    checksum: cs.checksum,
    sizeBytes: st.size,
    users: counts.users,
    bookings: counts.bookings,
    rtoSeconds: Number(elapsedSec),
    status: "PASS",
  };
  const reportPath = join(BACKUP_DIR, "verify-restore-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`[verify-restore] ✅ PASS — report → ${reportPath}`);
}

main().catch((err) => {
  console.error("[verify-restore] fatal:", err);
  process.exit(1);
});
