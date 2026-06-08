/**
 * PostgreSQL backup — runnable on this machine and in production.
 *
 * Produces a compressed custom-format dump (pg_dump -Fc), verifies its integrity
 * (pg_restore --list), and applies a retention policy. Cross-platform (Bun, no
 * bash) so it runs on the Windows dev box and in a Linux container alike.
 *
 *   Local (dump runs inside the Postgres container):
 *     BACKUP_DOCKER_CONTAINER=homigo-postgres bun run scripts/backup-db.ts
 *
 *   Production (pg_dump on PATH, dumps the DATABASE_URL target directly):
 *     bun run scripts/backup-db.ts
 *
 * Optional offsite upload (only when AWS_S3_BUCKET is set; requires aws CLI):
 *     AWS_S3_BUCKET=s3://homigo-backups bun run scripts/backup-db.ts
 *
 * RPO note: schedule this hourly (cron / k8s CronJob) for a ~1h RPO. For RPO→0
 * use a streaming replica in addition to these snapshots.
 */
import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CONTAINER = process.env.BACKUP_DOCKER_CONTAINER ?? "";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";

function parseDbUrl(url: string) {
  // postgresql://user:pass@host:port/db
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL is not in postgresql://user:pass@host:port/db form");
  return { user: m[1], password: m[2], host: m[3], port: m[4], db: m[5] };
}

/** Split `s3://bucket/optional/prefix` into bucket + key prefix. */
function parseS3Target(url: string): { bucket: string; prefix: string } {
  const stripped = url.replace(/^s3:\/\//, "").replace(/\/+$/, "");
  const [bucket, ...rest] = stripped.split("/");
  return { bucket, prefix: rest.length ? rest.join("/") + "/" : "" };
}

/**
 * Offsite upload via the AWS SDK (no aws CLI needed). Streams the dump with
 * multipart under the hood (lib-storage), server-side encrypted (AES256).
 * Credentials are read from the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 * env vars by the SDK. Fail-safe: a failed upload never fails the backup — the
 * local copy is retained.
 */
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

/** Run a command, streaming stdout to `outStream` (for binary dumps). */
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
    if (opts.inStream) opts.inStream.pipe(child.stdin);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err) }));
  });
}

async function main() {
  const db = parseDbUrl(DATABASE_URL);
  await mkdir(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(BACKUP_DIR, `homigo_${ts}.dump`);

  console.log(`[backup] dumping ${db.db} → ${file}${CONTAINER ? ` (via container ${CONTAINER})` : ""}`);

  // pg_dump custom format (-Fc) is internally compressed and supports parallel restore.
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
  console.log(`[backup] ✅ dump complete — ${(size / 1024).toFixed(1)} KB`);

  // Integrity check: a valid archive lists its table of contents without error.
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

  // Optional offsite upload — only when configured; never silently assumed.
  if (S3_BUCKET) {
    await uploadToS3(file);
  } else {
    console.log("[backup] (AWS_S3_BUCKET unset → local-only; set it for offsite copies)");
  }

  // Retention: prune dumps older than RETENTION_DAYS.
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  let pruned = 0;
  for (const name of await readdir(BACKUP_DIR)) {
    if (!name.startsWith("homigo_") || !name.endsWith(".dump")) continue;
    const p = join(BACKUP_DIR, name);
    if ((await stat(p)).mtimeMs < cutoff) {
      await unlink(p);
      pruned++;
    }
  }
  console.log(`[backup] retention: kept <${RETENTION_DAYS}d, pruned ${pruned} old dump(s)`);
  console.log("[backup] done ✅");
}

main().catch((e) => {
  console.error("[backup] fatal:", e);
  process.exit(1);
});
