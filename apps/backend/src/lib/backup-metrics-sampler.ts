/**
 * Expose backup metrics on /metrics by reading state written by backup-db.ts.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { setGauge, registerScrapeSampler } from "./metrics";

const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";

interface BackupMetricsState {
  backup_total: number;
  backup_size_bytes: number;
  backup_last_success_timestamp: number;
  backup_retention_deleted_total: number;
}

const DEFAULT: BackupMetricsState = {
  backup_total: 0,
  backup_size_bytes: 0,
  backup_last_success_timestamp: 0,
  backup_retention_deleted_total: 0,
};

async function readState(): Promise<BackupMetricsState> {
  try {
    const raw = await readFile(join(BACKUP_DIR, "backup-metrics.json"), "utf8");
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT };
  }
}

async function countLocalBackups(): Promise<number> {
  try {
    const names = await readdir(BACKUP_DIR);
    return names.filter((n) => n.startsWith("homigo_") && n.endsWith(".dump")).length;
  } catch {
    return 0;
  }
}

async function newestBackupSize(): Promise<number> {
  try {
    const names = (await readdir(BACKUP_DIR)).filter((n) => n.startsWith("homigo_") && n.endsWith(".dump"));
    let newest: { size: number; mtime: number } | null = null;
    for (const name of names) {
      const st = await stat(join(BACKUP_DIR, name));
      if (!newest || st.mtimeMs > newest.mtime) newest = { size: st.size, mtime: st.mtimeMs };
    }
    return newest?.size ?? 0;
  } catch {
    return 0;
  }
}

export function registerBackupMetricSamplers(): void {
  registerScrapeSampler(async () => {
    const state = await readState();
    const liveCount = await countLocalBackups();
    const liveSize = await newestBackupSize();

    setGauge("backup_total", liveCount > 0 ? liveCount : state.backup_total);
    setGauge("backup_size_bytes", liveSize > 0 ? liveSize : state.backup_size_bytes);
    setGauge("backup_last_success_timestamp", state.backup_last_success_timestamp);
    setGauge("backup_retention_deleted_total", state.backup_retention_deleted_total);
  });
}
