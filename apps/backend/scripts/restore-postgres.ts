/**
 * HOMIGO PostgreSQL restore — production-capable, cross-platform (Bun).
 *
 * Restores a pg_dump custom-format archive into DATABASE_URL after:
 *   1. Backup file + optional .sha256 integrity check
 *   2. Safety snapshot of the current database
 *   3. pg_restore --clean --if-exists
 *   4. Row-count verification
 *
 * Usage:
 *   RESTORE_CONFIRM=yes bun --env-file=.env run scripts/restore-postgres.ts ./backups/homigo_2026-01-01.dump
 *
 * Set RESTORE_CONFIRM=yes to acknowledge destructive restore.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "";
const dumpArg = process.argv[2];

function parseDbUrl(url: string) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL must be postgresql://user:pass@host:port/db");
  return { user: m[1], password: m[2], host: m[3], port: m[4], db: m[5] };
}

function run(
  cmd: string,
  args: string[],
  opts: {
    env?: NodeJS.ProcessEnv;
    inStream?: NodeJS.ReadableStream;
    outStream?: NodeJS.WritableStream;
  } = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    if (opts.outStream) child.stdout.pipe(opts.outStream);
    else child.stdout.on("data", (d) => (stdout += d.toString()));
    if (opts.inStream) {
      child.stdin.on("error", () => {});
      opts.inStream.on("error", () => {});
      opts.inStream.pipe(child.stdin);
    }
    child.on("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err), stdout: "" }));
  });
}

async function verifyChecksum(file: string): Promise<void> {
  const sidecar = `${file}.sha256`;
  try {
    const expected = (await readFile(sidecar, "utf8")).trim().split(/\s+/)[0];
    const buf = await readFile(file);
    const actual = createHash("sha256").update(buf).digest("hex");
    if (expected !== actual) {
      throw new Error(`Checksum mismatch for ${file}`);
    }
    console.log("[restore] ✅ checksum verified");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[restore] (no .sha256 sidecar — skipping checksum verify)");
      return;
    }
    throw err;
  }
}

async function countRows(db: ReturnType<typeof parseDbUrl>, sql: string): Promise<number> {
  const result = CONTAINER
    ? await run("docker", ["exec", CONTAINER, "psql", "-U", db.user, "-d", db.db, "-t", "-A", "-c", sql], {
        env: { PGPASSWORD: db.password },
      })
    : await run("psql", ["-h", db.host, "-p", db.port, "-U", db.user, "-d", db.db, "-t", "-A", "-c", sql], {
        env: { PGPASSWORD: db.password },
      });
  if (result.code !== 0) throw new Error(result.stderr || "count query failed");
  return Number(result.stdout.trim() || "0");
}

async function main() {
  if (process.env.RESTORE_CONFIRM !== "yes") {
    console.error("Set RESTORE_CONFIRM=yes to run a destructive database restore.");
    process.exit(1);
  }
  if (!dumpArg) {
    console.error("Usage: bun run scripts/restore-postgres.ts <backup.dump>");
    process.exit(1);
  }

  const dumpFile = dumpArg.startsWith("/") || dumpArg.includes(":\\") ? dumpArg : join(BACKUP_DIR, dumpArg);
  const st = await stat(dumpFile).catch(() => null);
  if (!st?.isFile()) {
    console.error(`Backup not found: ${dumpFile}`);
    process.exit(1);
  }

  const db = parseDbUrl(DATABASE_URL);
  const logFile = join(BACKUP_DIR, `restore_${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  await mkdir(BACKUP_DIR, { recursive: true });

  console.log(`[restore] source=${dumpFile} target=${db.db}`);
  await verifyChecksum(dumpFile);

  const list = CONTAINER
    ? await run("docker", ["exec", "-i", CONTAINER, "pg_restore", "--list"], { inStream: createReadStream(dumpFile) })
    : await run("pg_restore", ["--list", dumpFile]);
  if (list.code !== 0) {
    console.error("[restore] ❌ archive integrity check failed");
    process.exit(1);
  }

  const safetyFile = join(BACKUP_DIR, `safety_${Date.now()}.dump`);
  console.log(`[restore] creating safety backup → ${safetyFile}`);
  const safetyOut = createWriteStream(safetyFile);
  const safety = CONTAINER
    ? await run("docker", ["exec", CONTAINER, "pg_dump", "-U", db.user, "-Fc", "--no-password", db.db], {
        outStream: safetyOut,
        env: { PGPASSWORD: db.password },
      })
    : await run("pg_dump", ["-h", db.host, "-p", db.port, "-U", db.user, "-Fc", "--no-password", db.db], {
        outStream: safetyOut,
        env: { PGPASSWORD: db.password },
      });
  await new Promise((r) => safetyOut.end(r));
  if (safety.code !== 0) {
    console.error("[restore] ❌ safety backup failed — aborting");
    process.exit(1);
  }

  console.log("[restore] restoring archive (pg_restore --clean --if-exists)…");
  const restore = CONTAINER
    ? await run(
        "docker",
        ["exec", "-i", CONTAINER, "pg_restore", "-U", db.user, "-d", db.db, "--clean", "--if-exists", "--no-owner"],
        { env: { PGPASSWORD: db.password }, inStream: createReadStream(dumpFile) },
      )
    : await run(
        "pg_restore",
        ["-h", db.host, "-p", db.port, "-U", db.user, "-d", db.db, "--clean", "--if-exists", "--no-owner", dumpFile],
        { env: { PGPASSWORD: db.password } },
      );

  await writeFile(logFile, `${restore.stdout}\n${restore.stderr}`);
  if (restore.code !== 0) {
    console.error(`[restore] ❌ restore failed — see ${logFile}`);
    process.exit(1);
  }

  const users = await countRows(db, 'SELECT COUNT(*) FROM "users"');
  const bookings = await countRows(db, 'SELECT COUNT(*) FROM "bookings"');
  console.log(`[restore] verification users=${users} bookings=${bookings}`);
  if (users <= 0) {
    console.error("[restore] ❌ verification failed (no users)");
    process.exit(1);
  }

  const report = [
    `timestamp=${new Date().toISOString()}`,
    `backup=${dumpFile}`,
    `safety=${safetyFile}`,
    `users=${users}`,
    `bookings=${bookings}`,
    `log=${logFile}`,
  ].join("\n");
  await writeFile(join(BACKUP_DIR, "last-restore-report.txt"), report);
  console.log("[restore] ✅ complete");
}

main().catch((err) => {
  console.error("[restore] fatal:", err);
  process.exit(1);
});
