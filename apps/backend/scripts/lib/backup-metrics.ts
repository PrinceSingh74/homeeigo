/**
 * Persist backup Prometheus metrics to disk so the backend scrape sampler
 * can expose them on /metrics even when backups run as a standalone script.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface BackupMetricsState {
  backup_total: number;
  backup_size_bytes: number;
  backup_last_success_timestamp: number;
  backup_retention_deleted_total: number;
  updatedAt: string;
}

const DEFAULT: BackupMetricsState = {
  backup_total: 0,
  backup_size_bytes: 0,
  backup_last_success_timestamp: 0,
  backup_retention_deleted_total: 0,
  updatedAt: new Date(0).toISOString(),
};

export function metricsStatePath(backupDir: string): string {
  return join(backupDir, "backup-metrics.json");
}

export async function readBackupMetrics(backupDir: string): Promise<BackupMetricsState> {
  try {
    const raw = await readFile(metricsStatePath(backupDir), "utf8");
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT };
  }
}

export async function writeBackupMetrics(
  backupDir: string,
  patch: Partial<BackupMetricsState>,
): Promise<BackupMetricsState> {
  try {
    await mkdir(backupDir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const prev = await readBackupMetrics(backupDir);
  const next: BackupMetricsState = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(metricsStatePath(backupDir), JSON.stringify(next, null, 2));
  return next;
}

export async function recordBackupSuccess(
  backupDir: string,
  sizeBytes: number,
  totalBackups: number,
): Promise<void> {
  await writeBackupMetrics(backupDir, {
    backup_total: totalBackups,
    backup_size_bytes: sizeBytes,
    backup_last_success_timestamp: Math.floor(Date.now() / 1000),
  });
}

export async function recordRetentionDeletions(backupDir: string, deletedCount: number): Promise<void> {
  if (deletedCount <= 0) return;
  const prev = await readBackupMetrics(backupDir);
  await writeBackupMetrics(backupDir, {
    backup_retention_deleted_total: prev.backup_retention_deleted_total + deletedCount,
  });
}
