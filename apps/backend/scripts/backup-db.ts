/**
 * PostgreSQL backup — runnable on this machine and in production.
 *
 * Produces a compressed custom-format dump (pg_dump -Fc), verifies its integrity
 * (pg_restore --list + SHA256), applies enterprise GFS retention, and writes
 * backup-manifest.json. Cross-platform (Bun, no bash).
 *
 * Retention policy (enterprise GFS):
 *   - 7 daily, 4 weekly, 12 monthly snapshots
 *   - Never deletes the newest valid backup or monthly snapshots
 *
 *   Local (dump runs inside the Postgres container):
 *     BACKUP_DOCKER_CONTAINER=homigo-postgres bun run scripts/backup-db.ts
 *
 *   Production (pg_dump on PATH):
 *     bun run scripts/backup-db.ts
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { applyEnterpriseRetention, discoverBackups } from "./lib/backup-retention";
import { recordBackupSuccess, recordRetentionDeletions } from "./lib/backup-metrics";
import { ensureDir } from "./lib/safe-fs";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";

function parseDbUrl(url: string) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL is not in postgresql://user:pass@host:port/db form");
  return { user: m[1], password: m[2], host: m[3], port: m[4], db: m[5] };
}

function parseS3Target(url: string): { bucket: string; prefix: string } {
  const stripped = url.replace(/^s3:\/\//, "").replace(/\/+$/, "");
  const [bucket, ...rest] = stripped.split("/");
  return { bucket, prefix: rest.length ? rest.join("/") + "/" : "" };
}

async function uploadToS3(filePath: string): Promise<void> {
  const region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;
  if (!region) {
    console.log("[backup] ⚠️  AWS_DEFAULT_REGION unset — skipping S3 upload (local copy retained)");
    return;
  }
  const { bucket, prefix } = parseS3Target(S3_BUCKET);
  const key = prefix + basename(filePath);
  const client = new S3Client({ region });
  try {
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: createReadStream(filePath),
        ServerSideEncryption: "AES256",
      },
    });
    await upload.done();
    console.log(`[backup] ✅ uploaded to s3://${bucket}/${key} (region ${region}, SSE AES256)`);
  } catch (err) {
    console.log(
      `[backup] ⚠️  S3 upload failed (${err instanceof Error ? err.message : String(err)}) — local copy retained`,
    );
  } finally {
    client.destroy();
  }
}

function run(
  cmd: string,
  args: string[],
  opts: { outStream?: NodeJS.WritableStream; inStream?: NodeJS.ReadableStream; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    if (opts.outStream) child.stdout.pipe(opts.outStream);
    else child.stdout.on("data", () => {});
    if (opts.inStream) {
      child.stdin.on("error", () => {});
      opts.inStream.on("error", () => {});
      opts.inStream.pipe(child.stdin);
    }
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err) }));
  });
}

async function main() {
  const db = parseDbUrl(DATABASE_URL);
  await ensureDir(BACKUP_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(BACKUP_DIR, `homigo_${ts}.dump`);

  console.log(`[backup] dumping ${db.db} → ${file}${CONTAINER ? ` (via container ${CONTAINER})` : ""}`);

  const dumpArgs = ["-U", db.user, "-Fc", "--no-password", db.db];
  const out = createWriteStream(file);
  const { code, stderr } = CONTAINER
    ? await run("docker", ["exec", CONTAINER, "pg_dump", ...dumpArgs], {
        outStream: out,
        env: { PGPASSWORD: db.password },
      })
    : await run("pg_dump", ["-h", db.host, "-p", db.port, ...dumpArgs], {
        outStream: out,
        env: { PGPASSWORD: db.password },
      });
  await new Promise((r) => out.end(r));

  if (code !== 0) {
    console.error(`[backup] ❌ pg_dump failed (exit ${code}): ${stderr.trim()}`);
    process.exit(1);
  }
  const size = (await stat(file)).size;
  console.log(`[backup] ✅ dump complete — ${(size / 1024 / 1024).toFixed(2)} MB`);

  const verify = CONTAINER
    ? await run("docker", ["exec", "-i", CONTAINER, "pg_restore", "--list"], {
        inStream: createReadStream(file),
      })
    : await run("pg_restore", ["--list", file]);
  if (verify.code !== 0) {
    console.error(`[backup] ❌ integrity check FAILED: ${verify.stderr.trim()}`);
    process.exit(1);
  }
  console.log("[backup] ✅ integrity verified (pg_restore --list)");

  const checksum = createHash("sha256").update(await readFile(file)).digest("hex");
  await writeFile(`${file}.sha256`, `${checksum}  ${basename(file)}\n`);
  console.log(`[backup] checksum sha256=${checksum}`);

  if (S3_BUCKET) {
    await uploadToS3(file);
  } else {
    console.log("[backup] (AWS_S3_BUCKET unset → local-only; set it for offsite copies)");
  }

  const retention = await applyEnterpriseRetention(BACKUP_DIR, CONTAINER);
  const keptCount = retention.kept.length;
  const deletedCount = retention.deleted.length;

  console.log(
    `[backup] retention (GFS): kept ${keptCount} (7d/4w/12m), pruned ${deletedCount} expired dump(s)`,
  );
  if (retention.deleted.length > 0) {
    console.log(`[backup] deleted: ${retention.deleted.join(", ")}`);
  }
  if (retention.corrupt.length > 0) {
    console.log(`[backup] ⚠️  corrupt (not pruned): ${retention.corrupt.map((c) => c.filename).join(", ")}`);
  }
  if (retention.unverified.length > 0) {
    console.log(`[backup] ⚠️  unverified (pg_restore unavailable, not pruned): ${retention.unverified.map((c) => c.filename).join(", ")}`);
  }
  console.log(`[backup] manifest → ${join(BACKUP_DIR, "backup-manifest.json")}`);

  const totalBackups = (await discoverBackups(BACKUP_DIR)).length;
  await recordBackupSuccess(BACKUP_DIR, size, totalBackups);
  await recordRetentionDeletions(BACKUP_DIR, deletedCount);

  console.log("[backup] done ✅");
}

main().catch((e) => {
  console.error("[backup] fatal:", e);
  process.exit(1);
});
