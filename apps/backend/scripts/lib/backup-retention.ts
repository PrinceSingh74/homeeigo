/**
 * Enterprise GFS backup retention — daily / weekly / monthly tiers.
 *
 * Policy:
 *   - Keep last 7 daily backups (newest per calendar day)
 *   - Keep last 4 weekly backups (newest per ISO week)
 *   - Keep last 12 monthly backups (newest per calendar month)
 *
 * Safety rules:
 *   - Never delete the newest valid backup
 *   - Never delete monthly-tier snapshots
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, join } from "node:path";

export type RetentionTier = "newest" | "monthly" | "weekly" | "daily";

export const RETENTION_POLICY = {
  daily: 7,
  weekly: 4,
  monthly: 12,
} as const;

export interface BackupRecord {
  filename: string;
  path: string;
  size: number;
  createdAt: Date;
  checksum: string | null;
  integrityOk: boolean;
  integrityVerified: boolean;
  checksumOk: boolean;
  retentionTier: RetentionTier | null;
}

export interface ManifestEntry {
  filename: string;
  size: number;
  createdAt: string;
  checksum: string | null;
  retentionTier: RetentionTier | null;
  integrityOk: boolean;
  integrityVerified: boolean;
  checksumOk: boolean;
}

export interface RetentionResult {
  kept: BackupRecord[];
  deleted: string[];
  corrupt: BackupRecord[];
  unverified: BackupRecord[];
  manifest: ManifestEntry[];
}

function run(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; inStream?: NodeJS.ReadableStream } = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {});
    if (opts.inStream) {
      child.stdin.on("error", () => {});
      opts.inStream.on("error", () => {});
      opts.inStream.pipe(child.stdin);
    }
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err) }));
  });
}

/** Parse timestamp embedded in homigo_YYYY-MM-DDTHH-MM-SS-mmmZ.dump filenames. */
export function parseBackupTimestamp(filename: string): Date | null {
  const m = filename.match(/^homigo_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.dump$/);
  if (!m) return null;
  const iso = m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 week key (YYYY-Www). */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function recentMonthKeys(count: number, from = new Date()): string[] {
  const keys: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = 0; i < count; i++) {
    keys.push(monthKey(d));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return keys;
}

function recentWeekKeys(count: number, from = new Date()): string[] {
  const keys: string[] = [];
  const d = new Date(from);
  while (keys.length < count) {
    const wk = isoWeekKey(d);
    if (!keys.includes(wk)) keys.push(wk);
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return keys;
}

function recentDayKeys(count: number, from = new Date()): string[] {
  const keys: string[] = [];
  const d = new Date(from);
  for (let i = 0; i < count; i++) {
    keys.push(dayKey(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return keys;
}

export async function pgRestoreAvailable(container = ""): Promise<boolean> {
  if (container) {
    const r = await run("docker", ["exec", container, "pg_restore", "--version"]);
    return r.code === 0;
  }
  const r = await run("pg_restore", ["--version"]);
  return r.code === 0;
}

export async function verifyArchiveIntegrity(
  filePath: string,
  container = "",
): Promise<{ ok: boolean; verified: boolean }> {
  const available = await pgRestoreAvailable(container);
  if (!available) return { ok: false, verified: false };
  const verify = container
    ? await run("docker", ["exec", "-i", container, "pg_restore", "--list"], {
        inStream: createReadStream(filePath),
      })
    : await run("pg_restore", ["--list", filePath]);
  return { ok: verify.code === 0, verified: true };
}

export async function verifyChecksum(filePath: string): Promise<{ ok: boolean; checksum: string | null }> {
  const sidecar = `${filePath}.sha256`;
  const buf = await readFile(filePath);
  const actual = createHash("sha256").update(buf).digest("hex");
  try {
    const expected = (await readFile(sidecar, "utf8")).trim().split(/\s+/)[0];
    return { ok: expected === actual, checksum: actual };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, checksum: actual };
    }
    throw err;
  }
}

export async function discoverBackups(backupDir: string): Promise<BackupRecord[]> {
  const names = (await readdir(backupDir)).filter((n) => n.startsWith("homigo_") && n.endsWith(".dump"));
  const records: BackupRecord[] = [];
  for (const filename of names) {
    const path = join(backupDir, filename);
    const st = await stat(path);
    const createdAt = parseBackupTimestamp(filename) ?? st.mtime;
    records.push({
      filename,
      path,
      size: st.size,
      createdAt,
      checksum: null,
      integrityOk: false,
      integrityVerified: false,
      checksumOk: false,
      retentionTier: null,
    });
  }
  return records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function verifyBackups(
  records: BackupRecord[],
  container = "",
): Promise<BackupRecord[]> {
  const verified: BackupRecord[] = [];
  for (const rec of records) {
    const integrity = await verifyArchiveIntegrity(rec.path, container);
    let checksumOk = false;
    let checksum: string | null = null;
    if (integrity.verified) {
      const cs = await verifyChecksum(rec.path);
      checksumOk = cs.ok;
      checksum = cs.checksum;
    } else if (rec.size > 0) {
      // pg_restore unavailable — compute checksum but skip integrity verdict.
      const cs = await verifyChecksum(rec.path);
      checksum = cs.checksum;
      checksumOk = cs.ok;
    }
    verified.push({
      ...rec,
      integrityOk: integrity.verified ? integrity.ok : false,
      integrityVerified: integrity.verified,
      checksumOk,
      checksum,
    });
  }
  return verified;
}

const TIER_RANK: Record<RetentionTier, number> = {
  monthly: 4,
  newest: 3,
  weekly: 2,
  daily: 1,
};

/** Compute which backups to keep under enterprise GFS policy. */
export function computeRetentionPlan(
  records: BackupRecord[],
  now = new Date(),
): Map<string, RetentionTier> {
  const valid = records.filter((r) => r.integrityVerified && r.integrityOk && r.checksumOk);
  const sorted = [...valid].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const kept = new Map<string, RetentionTier>();

  if (sorted.length === 0) return kept;

  const assign = (filename: string, tier: RetentionTier) => {
    const existing = kept.get(filename);
    if (!existing || TIER_RANK[tier] > TIER_RANK[existing]) {
      kept.set(filename, tier);
    }
  };

  // Rule: never delete newest valid backup.
  assign(sorted[0].filename, "newest");

  // Monthly — last 12 calendar months (never delete these).
  for (const mk of recentMonthKeys(RETENTION_POLICY.monthly, now)) {
    const match = sorted.find((b) => monthKey(b.createdAt) === mk);
    if (match) assign(match.filename, "monthly");
  }

  // Weekly — last 4 ISO weeks.
  for (const wk of recentWeekKeys(RETENTION_POLICY.weekly, now)) {
    const match = sorted.find((b) => isoWeekKey(b.createdAt) === wk);
    if (match) assign(match.filename, "weekly");
  }

  // Daily — last 7 calendar days.
  for (const dk of recentDayKeys(RETENTION_POLICY.daily, now)) {
    const match = sorted.find((b) => dayKey(b.createdAt) === dk);
    if (match) assign(match.filename, "daily");
  }

  return kept;
}

export function toManifest(records: BackupRecord[], kept: Map<string, RetentionTier>): ManifestEntry[] {
  return records.map((r) => ({
    filename: r.filename,
    size: r.size,
    createdAt: r.createdAt.toISOString(),
    checksum: r.checksum,
    retentionTier: kept.get(r.filename) ?? null,
    integrityOk: r.integrityOk,
    integrityVerified: r.integrityVerified,
    checksumOk: r.checksumOk,
  }));
}

export async function writeManifest(backupDir: string, manifest: ManifestEntry[]): Promise<string> {
  const path = join(backupDir, "backup-manifest.json");
  await writeFile(path, JSON.stringify({ generatedAt: new Date().toISOString(), backups: manifest }, null, 2));
  return path;
}

export async function applyEnterpriseRetention(
  backupDir: string,
  container = "",
  dryRun = false,
): Promise<RetentionResult> {
  const discovered = await discoverBackups(backupDir);
  const verified = await verifyBackups(discovered, container);
  const valid = verified.filter((r) => r.integrityVerified && r.integrityOk && r.checksumOk);
  const corrupt = verified.filter((r) => r.integrityVerified && (!r.integrityOk || !r.checksumOk));
  const unverified = verified.filter((r) => !r.integrityVerified);
  const keptMap = computeRetentionPlan(verified);

  const keptFilenames = new Set(keptMap.keys());
  const kept = verified
    .filter((r) => keptFilenames.has(r.filename))
    .map((r) => ({ ...r, retentionTier: keptMap.get(r.filename)! }));

  const deleted: string[] = [];
  for (const rec of verified) {
    if (keptFilenames.has(rec.filename)) continue;
    // Only delete verified-valid backups outside the retention plan.
    if (!rec.integrityVerified || !rec.integrityOk || !rec.checksumOk) continue;
    deleted.push(rec.filename);
    if (!dryRun) {
      await unlink(rec.path).catch(() => undefined);
      await unlink(`${rec.path}.sha256`).catch(() => undefined);
    }
  }

  // Prune orphan sidecars whose dump is gone.
  if (!dryRun) {
    for (const name of await readdir(backupDir)) {
      if (!name.endsWith(".sha256")) continue;
      const dumpName = name.replace(/\.sha256$/, "");
      if (!dumpName.endsWith(".dump")) continue;
      try {
        await stat(join(backupDir, dumpName));
      } catch {
        await unlink(join(backupDir, name)).catch(() => undefined);
      }
    }
  }

  const manifest = toManifest(
    verified.map((r) => ({
      ...r,
      retentionTier: keptMap.get(r.filename) ?? null,
    })),
    keptMap,
  );

  if (!dryRun) {
    await writeManifest(backupDir, manifest);
  }

  return { kept, deleted, corrupt, unverified, manifest };
}
