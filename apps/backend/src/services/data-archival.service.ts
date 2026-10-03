import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";

const DEFAULT_RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS || 90);
const BATCH_SIZE = 500;

export type ArchivalResult = {
  appLogsPruned: number;
  activityLogsPruned: number;
  notificationsPruned: number;
  /** Present only when one or more models failed to prune this run — see per-model log lines. */
  errors?: Record<string, string>;
};

export class DataArchivalService {
  /**
   * Prunes each retained model independently. Previously a failure pruning appLogEntry aborted
   * the whole run before notification pruning was even attempted — an unrelated model's outage
   * silently deferred a wholly separate retention obligation for a full 24h with no record of why,
   * and any batches already deleted before the failure were logged nowhere (the rows were gone;
   * the count of what happened was not). Each model now prunes independently, failures are
   * per-model and visible (specific log line + metric), and the aggregate result always reflects
   * what actually happened rather than being silently discarded on the first error.
   */
  async runArchival(retentionDays = DEFAULT_RETENTION_DAYS): Promise<ArchivalResult> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const errors: Record<string, string> = {};

    const appLogsPruned = await this.pruneModelSafely("appLogEntry", cutoff, {}, errors);
    // Activity logs retained via enterprise audit retention (P4); do not hard-delete here.
    const activityLogsPruned = 0;
    const notificationsPruned = await this.pruneModelSafely("notification", cutoff, { isArchived: true }, errors);

    const result: ArchivalResult = {
      appLogsPruned,
      activityLogsPruned,
      notificationsPruned,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    };

    incCounter("data_archival_run_total", { result: result.errors ? "partial_failure" : "success" });

    if (result.errors) {
      logger.error("data_archival_partial_failure", { category: "APPLICATION", ...result, retentionDays });
    } else {
      logger.info("data_archival_completed", { category: "APPLICATION", ...result, retentionDays });
    }

    return result;
  }

  private async pruneModelSafely(
    model: "appLogEntry" | "notification",
    cutoff: Date,
    extraWhere: Record<string, unknown>,
    errors: Record<string, string>,
  ): Promise<number> {
    try {
      const count = await this.pruneInBatches(model, cutoff, extraWhere);
      incCounter("data_archival_pruned_total", { model, result: "success" }, count);
      return count;
    } catch (err) {
      const partialCount = err instanceof PartialPruneError ? err.partialCount : 0;
      const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
      errors[model] = message;
      incCounter("data_archival_pruned_total", { model, result: partialCount > 0 ? "partial" : "failed" }, partialCount);
      logger.warn("data_archival_model_prune_failed", { category: "APPLICATION", model, error: message, partialCount });
      return partialCount;
    }
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

  /**
   * If a mid-loop batch fails (e.g. a transient DB hiccup on batch 3 of 5), the earlier batches'
   * deletes already committed — but `total` was only ever held in this function's local scope, so
   * throwing here previously discarded that count entirely: the rows were gone, but nothing the
   * caller could see said how many. `PartialPruneError` carries the accurate partial count out.
   */
  private async pruneInBatches(
    model: "appLogEntry" | "activityLog" | "notification",
    cutoff: Date,
    extraWhere: Record<string, unknown> = {},
  ): Promise<number> {
    let total = 0;
    for (;;) {
      try {
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
      } catch (err) {
        throw new PartialPruneError(err instanceof Error ? err.message : String(err), total);
      }
    }
    return total;
  }
}

export class PartialPruneError extends Error {
  constructor(
    message: string,
    public readonly partialCount: number,
  ) {
    super(message);
    this.name = "PartialPruneError";
  }
}

export const dataArchivalService = new DataArchivalService();
