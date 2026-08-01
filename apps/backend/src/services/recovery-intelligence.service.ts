import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const DR_RTO_TARGET_SEC = Number(process.env.DR_RTO_TARGET_SEC ?? 3600);
const DR_RPO_TARGET_SEC = Number(process.env.DR_RPO_TARGET_SEC ?? 86400);

interface BackupMetricsState {
  backup_total: number;
  backup_size_bytes: number;
  backup_last_success_timestamp: number;
  backup_retention_deleted_total: number;
}

async function readBackupState(): Promise<BackupMetricsState> {
  try {
    const raw = await readFile(join(BACKUP_DIR, "backup-metrics.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { backup_total: 0, backup_size_bytes: 0, backup_last_success_timestamp: 0, backup_retention_deleted_total: 0 };
  }
}

async function countBackups(): Promise<number> {
  try {
    const names = await readdir(BACKUP_DIR);
    return names.filter((n) => n.startsWith("homigo_") && n.endsWith(".dump")).length;
  } catch {
    return 0;
  }
}

export class RecoveryIntelligenceService {
  async getStatus() {
    const [state, liveCount] = await Promise.all([readBackupState(), countBackups()]);
    const backupCount = liveCount > 0 ? liveCount : state.backup_total;
    const lastSuccess = state.backup_last_success_timestamp;
    const ageSec = lastSuccess > 0 ? Math.floor(Date.now() / 1000 - lastSuccess) : null;
    const successRate =
      backupCount > 0 && lastSuccess > 0 ? (ageSec != null && ageSec < 86400 * 2 ? 100 : Math.max(0, 100 - (ageSec ?? 0) / 864)) : null;

    let drReport: { rtoSeconds?: number; restoredAt?: string } | null = null;
    try {
      const raw = await readFile(join(BACKUP_DIR, "restore-validation-report.json"), "utf8");
      drReport = JSON.parse(raw);
    } catch {
      drReport = null;
    }

    const rpoSeconds = ageSec;
    const rtoSeconds = drReport?.rtoSeconds ?? null;
    const drReadinessScore =
      lastSuccess > 0 && backupCount > 0
        ? Math.round(
            (lastSuccess > 0 ? 40 : 0) +
              (successRate != null && successRate >= 90 ? 30 : 0) +
              (rtoSeconds != null && rtoSeconds <= DR_RTO_TARGET_SEC ? 30 : rtoSeconds == null ? 15 : 0),
          )
        : 0;

    return {
      generatedAt: new Date().toISOString(),
      backup: {
        health: backupCount > 0 && lastSuccess > 0 ? "healthy" : backupCount > 0 ? "degraded" : "unknown",
        totalBackups: backupCount,
        lastSuccessAt: lastSuccess > 0 ? new Date(lastSuccess * 1000).toISOString() : null,
        sizeBytes: state.backup_size_bytes,
        successRatePct: successRate,
        retentionDeleted: state.backup_retention_deleted_total,
        backupDir: BACKUP_DIR,
      },
      disasterRecovery: {
        readinessScore: drReadinessScore,
        rtoTargetSeconds: DR_RTO_TARGET_SEC,
        rtoLastDrillSeconds: rtoSeconds,
        rpoTargetSeconds: DR_RPO_TARGET_SEC,
        rpoCurrentSeconds: rpoSeconds,
        lastRestoreValidation: drReport?.restoredAt ?? null,
      },
    };
  }

  /** Non-destructive recovery simulation — projects steps and targets only. */
  simulate(target: "database" | "redis" | "queue" | "api" | "region") {
    const plans: Record<string, string[]> = {
      database: [
        "Promote read replica or restore latest homigo_*.dump from BACKUP_DIR",
        "Run prisma migrate deploy",
        "Verify financial integrity + wallet reconciliation",
      ],
      redis: ["Failover to Redis replica / cluster", "Warm cache from Postgres", "Verify WS fanout channel ws:fanout"],
      queue: ["Drain assignment jobs table", "Release assignment:processor lock", "Scale queue-workers deployment"],
      api: ["Shift traffic via load balancer", "Scale backend HPA pods", "Verify /ready and /metrics"],
      region: ["DNS failover to secondary region", "Restore DB from cross-region backup", "Replay Redis pub/sub subscriptions"],
    };
    return {
      target,
      simulatedAt: new Date().toISOString(),
      destructive: false,
      estimatedRtoSeconds: DR_RTO_TARGET_SEC,
      estimatedRpoSeconds: DR_RPO_TARGET_SEC,
      steps: plans[target] ?? [],
    };
  }
}

export const recoveryIntelligenceService = new RecoveryIntelligenceService();
