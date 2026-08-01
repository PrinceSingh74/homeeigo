import prisma from "../lib/prisma";
import { logger } from "../lib/logger";

const DEFAULT_RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS || 90);
const BATCH_SIZE = 500;

export type ArchivalResult = {
  appLogsPruned: number;
  activityLogsPruned: number;
  notificationsPruned: number;
};

export class DataArchivalService {
  async runArchival(retentionDays = DEFAULT_RETENTION_DAYS): Promise<ArchivalResult> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let appLogsPruned = 0;
    let activityLogsPruned = 0;
    let notificationsPruned = 0;

    appLogsPruned = await this.pruneInBatches("appLogEntry", cutoff);
    // Activity logs retained via enterprise audit retention (P4); do not hard-delete here.
    notificationsPruned = await this.pruneInBatches("notification", cutoff, {
      isArchived: true,
    });

    logger.info("data_archival_completed", {
      category: "APPLICATION",
      appLogsPruned,
      activityLogsPruned,
      notificationsPruned,
      retentionDays,
    });

    return { appLogsPruned, activityLogsPruned, notificationsPruned };
  }

  getStrategy() {
    return {
      partitioning: {
        strategy: "time_based_retention",
        tables: ["app_log_entries", "activity_logs", "notifications", "journal_entries"],
        retentionDays: DEFAULT_RETENTION_DAYS,
        coldStorage: "S3 archive via backup-db.ts for PostgreSQL dumps",
        historicalReporting: "Finance reports use aggregated journal_entries; logs pruned after retention",
      },
      capacityTargets: {
        providers: 10_000,
        bookings: 100_000,
        notifications: 1_000_000,
        walletTransactions: 1_000_000,
        ledgerEntries: 1_000_000,
        auditLogs: 1_000_000,
      },
      indexes: [
        "app_log_entries(created_at)",
        "activity_logs(created_at)",
        "notifications(user_id, created_at)",
        "journal_entries(created_at)",
      ],
    };
  }

  private async pruneInBatches(
    model: "appLogEntry" | "activityLog" | "notification",
    cutoff: Date,
    extraWhere: Record<string, unknown> = {},
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await (prisma[model] as { findMany: (args: unknown) => Promise<{ id: string }[]> }).findMany({
        where: { createdAt: { lt: cutoff }, ...extraWhere },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);
      const deleted = await (prisma[model] as { deleteMany: (args: unknown) => Promise<{ count: number }> }).deleteMany({
        where: { id: { in: ids } },
      });
      total += deleted.count;
      if (rows.length < BATCH_SIZE) break;
    }
    return total;
  }
}

export const dataArchivalService = new DataArchivalService();
