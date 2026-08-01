import { runWithLeaderLock } from "./distributed-scheduler";
import { logger } from "./logger";
import { dataRetentionService } from "../services/data-retention.service";
import { walletService } from "../services/wallet.service";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let lastDailyKey = "";
let lastWeeklyKey = "";
let lastMonthlyKey = "";
let lastQuarterlyKey = "";

function utcDateKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function utcWeekKey() {
  const d = new Date();
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / DAY_MS + jan1.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

function utcMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

function utcQuarterKey() {
  const d = new Date();
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${quarter}`;
}

/**
 * Hourly retention tick — replaces node-cron with leader-locked intervals
 * compatible with HOMIGO's existing maintenance scheduler.
 */
export async function runRetentionSchedulerTick(): Promise<void> {
  await runWithLeaderLock("retention:wallet_pending_expire", 120, async () => {
    const expired = await walletService.expireStalePendingTopUps();
    if (expired > 0) {
      logger.info("wallet_pending_topups_expired", { count: expired });
    }
  });

  const hour = new Date().getUTCHours();
  const dayKey = utcDateKey();
  const weekKey = utcWeekKey();
  const monthKey = utcMonthKey();
  const quarterKey = utcQuarterKey();

  if (hour === 2 && lastDailyKey !== dayKey) {
    lastDailyKey = dayKey;
    await runWithLeaderLock("retention:daily_otp", 1800, async () => {
      await dataRetentionService.cleanupExpiredOTPs();
    });
    await runWithLeaderLock("retention:daily_compliance_sla", 600, async () => {
      await dataRetentionService.expireStaleComplianceRequests();
    });
  }

  if (hour === 3 && lastDailyKey === dayKey) {
    await runWithLeaderLock("retention:daily_tokens", 1800, async () => {
      await dataRetentionService.cleanupExpiredTokens();
    });
    await runWithLeaderLock("retention:daily_app_log_purge", 3600, async () => {
      await dataRetentionService.purgeAppLogEntries();
    });
    await runWithLeaderLock("retention:daily_match_score_purge", 3600, async () => {
      await dataRetentionService.purgeProviderMatchScores();
    });
  }

  if (hour === 4 && new Date().getUTCDay() === 0 && lastWeeklyKey !== weekKey) {
    lastWeeklyKey = weekKey;
    await runWithLeaderLock("retention:weekly_notifications", 3600, async () => {
      await dataRetentionService.archiveOldNotifications();
      await dataRetentionService.cleanupArchivedNotifications();
    });
  }

  if (hour === 5 && new Date().getUTCDate() === 1 && lastMonthlyKey !== monthKey) {
    lastMonthlyKey = monthKey;
    await runWithLeaderLock("retention:monthly_audit_archive", 7200, async () => {
      await dataRetentionService.archiveEnterpriseAuditLogs();
    });
  }

  if (hour === 6 && new Date().getUTCDate() === 1 && [0, 3, 6, 9].includes(new Date().getUTCMonth()) && lastQuarterlyKey !== quarterKey) {
    lastQuarterlyKey = quarterKey;
    await runWithLeaderLock("retention:quarterly_enforce", 7200, async () => {
      await dataRetentionService.enforceRetentionPolicies();
    });
  }
}

export async function bootstrapRetention(): Promise<void> {
  await dataRetentionService.ensurePoliciesSeeded();
  logger.info("retention_policies_seeded");
}
