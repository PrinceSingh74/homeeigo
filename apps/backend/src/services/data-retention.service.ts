import crypto from "crypto";
import { gunzipSync, gzipSync } from "zlib";
import type { Prisma, RetentionCategory } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { enterpriseAuditService } from "./enterprise-audit.service";
import { opsAlertService } from "./ops-alert.service";
import { OTPService } from "./otp.service";
import { RefreshTokenService } from "./refresh-token.service";
import { JWTService } from "./jwt.service";
import { tokenRevocationService } from "./token-revocation.service";
import { integrityHash } from "../lib/pii-crypto";

const BATCH_SIZE = 500;

export type RetentionConfig = {
  category: RetentionCategory;
  retentionDays: number;
  archiveAfterDays: number;
};

const DEFAULT_RETENTION: Record<RetentionCategory, RetentionConfig> = {
  SECURITY_EVENTS: { category: "SECURITY_EVENTS", retentionDays: 7 * 365, archiveAfterDays: 365 },
  PAYMENT_EVENTS: { category: "PAYMENT_EVENTS", retentionDays: 8 * 365, archiveAfterDays: 2 * 365 },
  FINANCIAL_LEDGER: { category: "FINANCIAL_LEDGER", retentionDays: 10 * 365, archiveAfterDays: 3 * 365 },
  LOGIN_EVENTS: { category: "LOGIN_EVENTS", retentionDays: 2 * 365, archiveAfterDays: 180 },
  SYSTEM_LOGS: { category: "SYSTEM_LOGS", retentionDays: 365, archiveAfterDays: 90 },
};

const otpService = new OTPService(prisma);
const refreshTokenService = new RefreshTokenService(prisma, new JWTService());

export class DataRetentionService {
  private async startJob(jobName: string, retryCount = 0) {
    return prisma.retentionJobRun.create({
      data: { jobName, status: "RUNNING", retryCount },
    });
  }

  private async completeJob(
    jobId: string,
    recordsProcessed: number,
    metadata?: Record<string, unknown>,
  ) {
    await prisma.retentionJobRun.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        recordsProcessed,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async failJob(jobId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.retentionJobRun.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message,
      },
    });
    await opsAlertService.raise("retention_job_failed", "WARNING", `Retention job failed: ${message}`, {
      jobId,
    });
  }

  async runJob<T>(
    jobName: string,
    fn: () => Promise<{ recordsProcessed: number; metadata?: Record<string, unknown> }>,
    retryCount = 0,
  ): Promise<T | void> {
    const job = await this.startJob(jobName, retryCount);
    try {
      const result = await fn();
      await this.completeJob(job.id, result.recordsProcessed, result.metadata);
      return result as T;
    } catch (err) {
      await this.failJob(job.id, err);
      if (retryCount < 2) {
        logger.warn("retention_job_retry", { jobName, retryCount: retryCount + 1 });
        return this.runJob(jobName, fn, retryCount + 1);
      }
      throw err;
    }
  }

  async ensurePoliciesSeeded() {
    for (const config of Object.values(DEFAULT_RETENTION)) {
      await prisma.auditRetentionPolicy.upsert({
        where: { category: config.category },
        create: {
          category: config.category,
          retentionDays: config.retentionDays,
          archiveAfterDays: config.archiveAfterDays,
        },
        update: {
          retentionDays: config.retentionDays,
          archiveAfterDays: config.archiveAfterDays,
          isActive: true,
        },
      });
    }
  }

  async cleanupExpiredOTPs() {
    return this.runJob("DAILY_OTP_CLEANUP", async () => {
      const expired = await otpService.deleteExpiredOTPs();
      const usedOld = await otpService.deleteOldUsedOTPs();
      const recordsProcessed = expired + usedOld;

      void enterpriseAuditService.recordSystemEvent({
        action: "OTP_CLEANUP",
        resource: "data_retention",
        status: "SUCCESS",
        changesSummary: `Deleted ${recordsProcessed} OTP records`,
        retentionCategory: "SYSTEM_LOGS",
      });

      logger.info("otp_cleanup_completed", { recordsProcessed });
      return { recordsProcessed };
    });
  }

  async cleanupExpiredTokens() {
    return this.runJob("DAILY_TOKEN_CLEANUP", async () => {
      const [blacklist, refresh] = await Promise.all([
        tokenRevocationService.cleanupExpiredRevocations(),
        refreshTokenService.deleteExpiredTokens(),
      ]);
      const recordsProcessed = blacklist + refresh;

      void enterpriseAuditService.recordSystemEvent({
        action: "TOKEN_CLEANUP",
        resource: "data_retention",
        status: "SUCCESS",
        changesSummary: `Removed ${refresh} refresh tokens and ${blacklist} blacklist entries`,
        retentionCategory: "SYSTEM_LOGS",
      });

      logger.info("token_cleanup_completed", { refresh, blacklist });
      return { recordsProcessed, metadata: { refresh, blacklist } };
    });
  }

  async archiveOldNotifications() {
    return this.runJob("WEEKLY_NOTIFICATION_ARCHIVE", async () => {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let recordsProcessed = 0;

      for (;;) {
        const rows = await prisma.notification.findMany({
          where: {
            createdAt: { lt: cutoff },
            isArchived: false,
            isRead: true,
          },
          select: { id: true },
          take: BATCH_SIZE,
        });
        if (rows.length === 0) break;

        const updated = await prisma.notification.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { isArchived: true, archivedAt: new Date() },
        });
        recordsProcessed += updated.count;
        if (rows.length < BATCH_SIZE) break;
      }

      logger.info("notification_archive_completed", { recordsProcessed });
      return { recordsProcessed };
    });
  }

  async cleanupArchivedNotifications() {
    return this.runJob("WEEKLY_NOTIFICATION_PURGE", async () => {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const deleted = await prisma.notification.deleteMany({
        where: { isArchived: true, archivedAt: { lt: cutoff } },
      });
      return { recordsProcessed: deleted.count };
    });
  }

  /**
   * Growth control for `app_log_entries` — the highest-volume operational table.
   * Hot window = APP_LOG_RETENTION_DAYS (default 90d). Rows older than the cutoff are
   * purged in batches (ctid-bounded raw delete) to avoid long locks / WAL spikes on the
   * multi-million-row table. Caps unbounded growth (was ~1.2 GB / 94% of the DB).
   */
  async purgeAppLogEntries() {
    return this.runJob("DAILY_APP_LOG_PURGE", async () => {
      const retentionDays = Number(process.env.APP_LOG_RETENTION_DAYS ?? 90);
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const APP_LOG_BATCH = 5000;
      let recordsProcessed = 0;

      for (;;) {
        const deleted = await prisma.$executeRaw`
          DELETE FROM app_log_entries
          WHERE ctid IN (
            SELECT ctid FROM app_log_entries
            WHERE created_at < ${cutoff}
            LIMIT ${APP_LOG_BATCH}
          )`;
        recordsProcessed += deleted;
        if (deleted < APP_LOG_BATCH) break;
      }

      logger.info("app_log_purge_completed", { recordsProcessed, retentionDays });
      return { recordsProcessed, metadata: { retentionDays, cutoff: cutoff.toISOString() } };
    });
  }

  /**
   * Growth control for `provider_match_scores` — write-only matching telemetry
   * (persisted at dispatch, never read back historically). Regenerates ~80k
   * rows/day, so without a sweep it bloats unbounded (was 295 MB / 861k stale
   * rows at audit time). Keep a short hot window for debugging recent matches.
   */
  async purgeProviderMatchScores() {
    return this.runJob("DAILY_MATCH_SCORE_PURGE", async () => {
      const retentionDays = Number(process.env.MATCH_SCORE_RETENTION_DAYS ?? 7);
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const BATCH = 5000;
      let recordsProcessed = 0;

      for (;;) {
        const deleted = await prisma.$executeRaw`
          DELETE FROM provider_match_scores
          WHERE ctid IN (
            SELECT ctid FROM provider_match_scores
            WHERE created_at < ${cutoff}
            LIMIT ${BATCH}
          )`;
        recordsProcessed += deleted;
        if (deleted < BATCH) break;
      }

      logger.info("match_score_purge_completed", { recordsProcessed, retentionDays });
      return { recordsProcessed, metadata: { retentionDays, cutoff: cutoff.toISOString() } };
    });
  }

  async archiveEnterpriseAuditLogs() {
    return this.runJob("MONTHLY_AUDIT_ARCHIVE", async () => {
      const policies = await prisma.auditRetentionPolicy.findMany({ where: { isActive: true } });
      let recordsProcessed = 0;

      for (const policy of policies) {
        const archiveAfterDays = policy.archiveAfterDays ?? DEFAULT_RETENTION[policy.category].archiveAfterDays;
        const cutoff = new Date(Date.now() - archiveAfterDays * 24 * 60 * 60 * 1000);

        for (;;) {
          const logs = await prisma.enterpriseAuditLog.findMany({
            where: {
              retentionCategory: policy.category,
              createdAt: { lt: cutoff },
              isArchived: false,
            },
            take: BATCH_SIZE,
          });
          if (logs.length === 0) break;

          for (const log of logs) {
            await this.archiveSingleAuditLog(log);
            recordsProcessed++;
          }
          if (logs.length < BATCH_SIZE) break;
        }
      }

      void enterpriseAuditService.recordSystemEvent({
        action: "AUDIT_ARCHIVE",
        resource: "data_retention",
        status: "SUCCESS",
        changesSummary: `Archived ${recordsProcessed} enterprise audit logs`,
        retentionCategory: "SYSTEM_LOGS",
      });

      return { recordsProcessed };
    });
  }

  private async archiveSingleAuditLog(log: {
    id: string;
    action: string;
    resource: string;
    actor: string | null;
    changesSummary: string | null;
    createdAt: Date;
    status: string;
    retentionCategory: RetentionCategory;
    retentionExpiresAt: Date | null;
  }) {
    const payload = JSON.stringify({
      action: log.action,
      resource: log.resource,
      actor: log.actor,
      changesSummary: log.changesSummary,
      createdAt: log.createdAt.toISOString(),
      status: log.status,
      retentionCategory: log.retentionCategory,
    });

    const compressed = gzipSync(payload).toString("base64");
    const archiveHash = integrityHash([payload]);

    await prisma.$transaction([
      prisma.enterpriseAuditLogArchive.create({
        data: {
          originalLogId: log.id,
          compressedData: compressed,
          archivedBy: "SYSTEM",
          archiveHash,
          deleteScheduledAt: log.retentionExpiresAt,
        },
      }),
      prisma.enterpriseAuditLog.update({
        where: { id: log.id },
        data: { isArchived: true, archivedAt: new Date() },
      }),
    ]);
  }

  async enforceRetentionPolicies() {
    return this.runJob("QUARTERLY_RETENTION_ENFORCE", async () => {
      const now = new Date();
      let recordsProcessed = 0;

      for (;;) {
        const expired = await prisma.enterpriseAuditLog.findMany({
          where: {
            retentionExpiresAt: { lt: now },
            isArchived: true,
          },
          select: { id: true },
          take: BATCH_SIZE,
        });
        if (expired.length === 0) break;

        const ids = expired.map((e) => e.id);
        await prisma.enterpriseAuditLog.deleteMany({ where: { id: { in: ids } } });
        recordsProcessed += ids.length;
        if (expired.length < BATCH_SIZE) break;
      }

      void enterpriseAuditService.recordSystemEvent({
        action: "RETENTION_ENFORCEMENT",
        resource: "data_retention",
        status: "SUCCESS",
        changesSummary: `Hard-deleted ${recordsProcessed} archived audit logs past retention`,
        retentionCategory: "SYSTEM_LOGS",
      });

      return { recordsProcessed };
    });
  }

  async expireStaleComplianceRequests() {
    return this.runJob("DAILY_COMPLIANCE_SLA", async () => {
      const now = new Date();
      const updated = await prisma.complianceRequest.updateMany({
        where: {
          status: "PENDING",
          dueDateAt: { lt: now },
        },
        data: { status: "EXPIRED" },
      });
      return { recordsProcessed: updated.count };
    });
  }

  async getRetentionReport() {
    const policies = await prisma.auditRetentionPolicy.findMany({ orderBy: { category: "asc" } });
    const report: Record<string, unknown> = {};

    for (const policy of policies) {
      const [totalLogs, archivedLogs, expiredLogs, jobRuns] = await Promise.all([
        prisma.enterpriseAuditLog.count({ where: { retentionCategory: policy.category } }),
        prisma.enterpriseAuditLog.count({
          where: { retentionCategory: policy.category, isArchived: true },
        }),
        prisma.enterpriseAuditLog.count({
          where: {
            retentionCategory: policy.category,
            retentionExpiresAt: { lt: new Date() },
          },
        }),
        prisma.retentionJobRun.findMany({
          where: { status: "COMPLETED" },
          orderBy: { startedAt: "desc" },
          take: 5,
        }),
      ]);

      report[policy.category] = {
        totalLogs,
        archivedLogs,
        expiredLogs,
        retentionDays: policy.retentionDays,
        archiveAfterDays: policy.archiveAfterDays,
        recentJobs: jobRuns.map((j) => ({
          jobName: j.jobName,
          recordsProcessed: j.recordsProcessed,
          startedAt: j.startedAt,
        })),
      };
    }

    return report;
  }

  async verifyArchiveIntegrity(archiveId: string): Promise<boolean> {
    const archive = await prisma.enterpriseAuditLogArchive.findUnique({ where: { id: archiveId } });
    if (!archive) return false;
    const raw = Buffer.from(archive.compressedData, "base64");
    const decompressed = gunzipSync(raw).toString("utf8");
    return integrityHash([decompressed]) === archive.archiveHash;
  }
}

export const dataRetentionService = new DataRetentionService();
