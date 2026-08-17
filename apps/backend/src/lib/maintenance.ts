import { spawn } from "child_process";
import path from "path";
import prisma from "./prisma";
import { OTPService } from "../services/otp.service";
import { paymentService } from "../services/payment.service";
import { accountLifecycleService } from "../services/account-lifecycle.service";
import { consentService } from "../services/consent.service";
import { assignmentEngine } from "../services/assignment-engine.service";
import { paymentReconciliationService } from "../services/payment-reconciliation.service";
import { financialIntegrityService } from "../services/financial-integrity.service";
import { trackingService } from "../services/tracking.service";
import { financeLiabilityService } from "../services/finance-liability.service";
import { settlementSyncService } from "../services/settlement-sync.service";
import { runWithLeaderLock } from "./distributed-scheduler";
import { alertEvaluatorService } from "../services/alert-evaluator.service";
import { opsMapService } from "../services/ops-map.service";
import { dataArchivalService } from "../services/data-archival.service";
import { logger } from "./logger";
import { tokenRevocationService } from "../services/token-revocation.service";
import { RefreshTokenService } from "../services/refresh-token.service";
import { JWTService } from "../services/jwt.service";
import { giftCardProtectionService } from "../services/gift-card-protection.service";
import { campaignLimitsService } from "../services/campaign-limits.service";
import { bootstrapRetention, runRetentionSchedulerTick } from "./retention-scheduler";
import { ledgerReconciliationService } from "../services/ledger-reconciliation.service";
import { bookingRefundService } from "../services/booking-refund.service";
import { financialLedgerService } from "../services/financial-ledger.service";
import { cleanupPublishedOutbox, startOutboxProcessor, stopOutboxProcessor } from "../events/core/outbox-processor";
import { startScheduledJobProcessor, stopScheduledJobProcessor } from "../events/core/job-processor";
import { bootstrapScheduledJobs } from "../events/jobs";
import { bootstrapWorkflows } from "../automation/registry/definitions";
import { cleanupEventPlatformData } from "../events/core/retention";
import { startEtlScheduler, stopEtlScheduler } from "../../analytics/scheduler/etl-scheduler";
import { expireStaleMemories, purgeExpiredContextCache } from "../ai-brain";

const AI_BRAIN_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

const OTP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ASSIGNMENT_INTERVAL_MS = 30 * 1000;
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
const FINANCE_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INTEGRITY_INTERVAL_MS = 60 * 60 * 1000;
const SETTLEMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;
const DELETION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ALERT_EVAL_INTERVAL_MS = 5 * 60 * 1000;
const OPS_ALERT_DISPATCH_INTERVAL_MS = 20 * 1000;
const ARCHIVAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_TICK_INTERVAL_MS = 60 * 60 * 1000;
const REFUND_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const LOCATION_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily (leader-locked)
const LOCATION_HISTORY_RETENTION_DAYS = 30;
const GEOFENCE_EVENT_RETENTION_DAYS = 90;

let locationRetentionTimer: ReturnType<typeof setInterval> | null = null;
let otpTimer: ReturnType<typeof setInterval> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let backupTimer: ReturnType<typeof setInterval> | null = null;
let deletionTimer: ReturnType<typeof setInterval> | null = null;
let assignmentTimer: ReturnType<typeof setInterval> | null = null;
let financeReconcileTimer: ReturnType<typeof setInterval> | null = null;
let integrityTimer: ReturnType<typeof setInterval> | null = null;
let settlementSyncTimer: ReturnType<typeof setInterval> | null = null;
let alertEvalTimer: ReturnType<typeof setInterval> | null = null;
let opsAlertDispatchTimer: ReturnType<typeof setInterval> | null = null;
let archivalTimer: ReturnType<typeof setInterval> | null = null;
let tokenCleanupTimer: ReturnType<typeof setInterval> | null = null;
let retentionTickTimer: ReturnType<typeof setInterval> | null = null;
let refundRetryTimer: ReturnType<typeof setInterval> | null = null;
let aiBrainMaintenanceTimer: ReturnType<typeof setInterval> | null = null;

const otpService = new OTPService(prisma);
const refreshTokenService = new RefreshTokenService(prisma, new JWTService());

async function runOtpCleanup(): Promise<void> {
  await runWithLeaderLock("maintenance:otp_cleanup", 300, async () => {
    const expired = await otpService.deleteExpiredOTPs();
    const usedOld = await otpService.deleteOldUsedOTPs();
    if (expired + usedOld > 0) {
      logger.info("otp_cleanup", { category: "APPLICATION", expired, usedOld });
    }
  });
}

async function runRefundRetry(): Promise<void> {
  await runWithLeaderLock("maintenance:refund_retry", 240, async () => {
    const result = await bookingRefundService.retryFailedRefunds(25);
    if (result.succeeded > 0) {
      logger.info("refund_retry", { category: "PAYMENT", ...result });
    }
  });
}

async function runReconcile(): Promise<void> {
  await runWithLeaderLock("maintenance:payment_reconcile", 600, async () => {
    const result = await paymentService.reconcilePendingOrders();
    if (result.giftCards + result.subscriptions > 0) {
      logger.info("payment_reconcile", {
        category: "PAYMENT",
        giftCards: result.giftCards,
        subscriptions: result.subscriptions,
      });
    }
  });
}

// Objective 7 — tracking/location lifecycle. Leader-locked so only one instance prunes.
async function runLocationRetention(): Promise<void> {
  await runWithLeaderLock("maintenance:location_retention", 3600, async () => {
    try {
      const locationsRemoved = await trackingService.cleanupHistory(LOCATION_HISTORY_RETENTION_DAYS);
      const cutoff = new Date(Date.now() - GEOFENCE_EVENT_RETENTION_DAYS * 86_400_000);
      const geofenceEvents = await prisma.geofenceEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
      logger.info("location_retention", {
        category: "APPLICATION",
        locationHistoryRemoved: locationsRemoved,
        geofenceEventsRemoved: geofenceEvents.count,
        locationRetentionDays: LOCATION_HISTORY_RETENTION_DAYS,
        geofenceRetentionDays: GEOFENCE_EVENT_RETENTION_DAYS,
      });
    } catch (err) {
      logger.warn("location_retention_failed", { category: "APPLICATION", error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function runBackup(): Promise<void> {
  if (process.env.ENABLE_SCHEDULED_BACKUPS !== "true") return;
  await runWithLeaderLock("maintenance:db_backup", 3600, async () => {
    const script = path.join(process.cwd(), "scripts", "backup-db.ts");
    spawn(process.execPath, ["run", script], {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    }).on("error", (e) =>
      logger.warn("backup_failed", { category: "APPLICATION", error: e.message }),
    );
  });
}

async function runAssignmentDispatch(): Promise<void> {
  try {
    const result = await assignmentEngine.processQueue();
    if (result.dispatched > 0) {
      logger.info("assignment_dispatch", {
        category: "PROVIDER",
        dispatched: result.dispatched,
        processed: result.processed,
      });
    }
  } catch (err) {
    logger.warn("assignment_dispatch_skipped", {
      category: "PROVIDER",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runFinanceReconciliation(): Promise<void> {
  await runWithLeaderLock("maintenance:finance_reconcile", 3600, async () => {
    const result = await paymentReconciliationService.runDailyReconciliation();
    logger.info("finance_reconciliation", {
      category: "FINANCE",
      matchPct: result.matchPct,
      issues: result.issues,
    });
  });
}

async function runFinancialIntegrity(): Promise<void> {
  await runWithLeaderLock("maintenance:financial_integrity", 1800, async () => {
    const result = await financialIntegrityService.runChecks();
    if (result.issues.length > 0) {
      logger.warn("financial_integrity_fail", {
        category: "FINANCE",
        issues: result.issues.length,
      });
      const hasLiabilityDrift = result.issues.some((i) =>
        ["WALLET_LIABILITY_MISMATCH", "PROVIDER_PAYABLE_MISMATCH", "HCOIN_LIABILITY_MISMATCH"].includes(
          i.category,
        ),
      );
      if (hasLiabilityDrift) {
        const reconciled = await ledgerReconciliationService.reconcile({ backfillLimit: 2000 });
        logger.info("ledger_reconciliation_auto", {
          category: "FINANCE",
          maxDelta: reconciled.maxDelta,
          adjustments: reconciled.adjustments.length,
        });
      }
    }
    await financeLiabilityService.captureSnapshot("DAILY").catch(() => undefined);
  });
}

/** Startup integrity gate — logs CRITICAL failures; blocks prod boot when configured. */
export async function runStartupFinancialIntegrity(): Promise<void> {
  await financialLedgerService.ensureAccountsSeeded();
  const result = await financialIntegrityService.validate();
  if (result.bySeverity.critical > 0) {
    logger.error("startup_integrity_critical", {
      category: "FINANCE",
      critical: result.bySeverity.critical,
      score: result.score,
    });
    if (process.env.BLOCK_BOOT_ON_INTEGRITY_FAIL === "true") {
      throw new Error(`Financial integrity CRITICAL: score ${result.score}`);
    }
  }
  if (result.status === "FAIL") {
    const reconciled = await ledgerReconciliationService.reconcile({ backfillLimit: 3000 });
    const after = await financialIntegrityService.validate();
    logger.info("startup_reconciliation", {
      category: "FINANCE",
      beforeScore: result.score,
      afterScore: after.score,
      maxDelta: reconciled.maxDelta,
    });
  }
}

async function runSettlementSync(): Promise<void> {
  if (!process.env.RAZORPAY_KEY_ID) return;
  await runWithLeaderLock("maintenance:settlement_sync", 3600, async () => {
    const result = await settlementSyncService.runSync();
    logger.info("settlement_sync", {
      category: "FINANCE",
      synced: result.synced,
      discrepancies: result.discrepancies,
    });
  });
}

async function runDeletionFinalize(): Promise<void> {
  await runWithLeaderLock("maintenance:deletion_finalize", 1800, async () => {
    const n = await accountLifecycleService.finalizeExpiredDeletions();
    if (n > 0) logger.info("deletion_finalize", { category: "SECURITY", count: n });
  });
}

async function runAlertEvaluation(): Promise<void> {
  await runWithLeaderLock("maintenance:alert_eval", 240, async () => {
    const result = await alertEvaluatorService.evaluateAll();
    alertEvaluatorService.updateWsMetrics();
    if (result.raised > 0) {
      logger.warn("alerts_raised", { category: "APPLICATION", raised: result.raised });
    }
  });
}

// Live ops-map alert push for the Admin Alert Center. Leader-locked so a given alert is
// pushed once across the cluster (no duplicate toasts). Reuses ops-map.service — no new engine.
async function runOpsAlertDispatch(): Promise<void> {
  await runWithLeaderLock("maintenance:ops_alert_dispatch", 18, async () => {
    try {
      const result = await opsMapService.dispatchLiveAlerts();
      if (result.emitted > 0 || result.skipped > 0) {
        logger.info("ops_alert_dispatch", {
          category: "APPLICATION",
          active: result.active,
          emitted: result.emitted,
          skipped: result.skipped,
          deduplicated: result.deduplicated,
          rateLimited: result.rateLimited,
          subscribers: result.subscribers,
        });
      }
    } catch (err) {
      logger.warn("ops_alert_dispatch_skipped", { category: "APPLICATION", error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function runDataArchival(): Promise<void> {
  await runWithLeaderLock("maintenance:data_archival", 3600, async () => {
    await dataArchivalService.runArchival();
  });
}

async function runTokenSecurityCleanup(): Promise<void> {
  await runWithLeaderLock("maintenance:token_security_cleanup", 600, async () => {
    const [blacklist, refresh, giftAttempts, campaignUsages] = await Promise.all([
      tokenRevocationService.cleanupExpiredRevocations(),
      refreshTokenService.deleteExpiredTokens(),
      giftCardProtectionService.cleanupOldAttempts(),
      campaignLimitsService.cleanupOldRedemptions(),
    ]);
    if (blacklist + refresh + giftAttempts + campaignUsages > 0) {
      logger.info("token_security_cleanup", {
        category: "SECURITY",
        blacklistRemoved: blacklist,
        refreshRemoved: refresh,
        giftAttemptsRemoved: giftAttempts,
        campaignUsagesRemoved: campaignUsages,
      });
    }
  });
}

async function runRetentionTick(): Promise<void> {
  await runWithLeaderLock("maintenance:retention_tick", 3000, async () => {
    await runRetentionSchedulerTick();
    const removed = await cleanupEventPlatformData().catch(() => ({
      publishedOutbox: 0,
      consumerReceipts: 0,
      resolvedDlq: 0,
      completedJobs: 0,
    }));
    if (removed.publishedOutbox + removed.consumerReceipts + removed.resolvedDlq + removed.completedJobs > 0) {
      logger.info("event_platform_cleanup", { category: "APPLICATION", ...removed });
    }
  });
}

async function runAiBrainMaintenance(): Promise<void> {
  await runWithLeaderLock("maintenance:ai_brain", 600, async () => {
    const [expiredMemories, purgedCache, expiredApprovals] = await Promise.all([
      expireStaleMemories(),
      purgeExpiredContextCache(),
      import("../ai-tools/approval/approval-engine").then((m) => m.expireStaleApprovals()).catch(() => 0),
    ]);
    if (expiredMemories > 0 || purgedCache > 0 || expiredApprovals > 0) {
      logger.info("ai_brain_maintenance", {
        category: "APPLICATION",
        expiredMemories,
        purgedCache,
        expiredApprovals,
      });
    }
  });
}

export function startMaintenance(): void {
  if (otpTimer) return;
  void consentService.ensurePolicyVersionsSeeded().catch(() => undefined);
  void bootstrapRetention().catch(() => undefined);
  startOutboxProcessor();
  bootstrapScheduledJobs();
  /**
   * Workflow definitions are registered and reconciled before the job processor starts.
   *
   * Order matters: a workflow step job arriving before its definition is in the registry would
   * find no code for its pinned version and fail the instance. Registering first closes that
   * window. A failure here is logged loudly rather than swallowed — the most likely cause is an
   * edited definition that running instances are pinned to, and that deserves attention.
   */
  void bootstrapWorkflows().catch((err) => {
    logger.error("workflow_bootstrap_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  startScheduledJobProcessor();
  startEtlScheduler();
  void runOtpCleanup();
  void runReconcile();
  void runAssignmentDispatch();
  void runFinanceReconciliation();
  void runFinancialIntegrity();
  void runAlertEvaluation();
  void runOpsAlertDispatch();
  void runTokenSecurityCleanup();
  void runRetentionTick();
  void runAiBrainMaintenance();
  void runRefundRetry();
  otpTimer = setInterval(() => void runOtpCleanup(), OTP_INTERVAL_MS);
  refundRetryTimer = setInterval(() => void runRefundRetry(), REFUND_RETRY_INTERVAL_MS);
  aiBrainMaintenanceTimer = setInterval(() => void runAiBrainMaintenance(), AI_BRAIN_MAINTENANCE_INTERVAL_MS);
  retentionTickTimer = setInterval(() => void runRetentionTick(), RETENTION_TICK_INTERVAL_MS);
  tokenCleanupTimer = setInterval(() => void runTokenSecurityCleanup(), TOKEN_CLEANUP_INTERVAL_MS);
  reconcileTimer = setInterval(() => void runReconcile(), RECONCILE_INTERVAL_MS);
  assignmentTimer = setInterval(() => void runAssignmentDispatch(), ASSIGNMENT_INTERVAL_MS);
  financeReconcileTimer = setInterval(() => void runFinanceReconciliation(), FINANCE_RECONCILE_INTERVAL_MS);
  integrityTimer = setInterval(() => void runFinancialIntegrity(), INTEGRITY_INTERVAL_MS);
  settlementSyncTimer = setInterval(() => void runSettlementSync(), SETTLEMENT_SYNC_INTERVAL_MS);
  backupTimer = setInterval(() => void runBackup(), BACKUP_INTERVAL_MS);
  locationRetentionTimer = setInterval(() => void runLocationRetention(), LOCATION_RETENTION_INTERVAL_MS);
  deletionTimer = setInterval(() => void runDeletionFinalize(), DELETION_INTERVAL_MS);
  alertEvalTimer = setInterval(() => void runAlertEvaluation(), ALERT_EVAL_INTERVAL_MS);
  opsAlertDispatchTimer = setInterval(() => void runOpsAlertDispatch(), OPS_ALERT_DISPATCH_INTERVAL_MS);
  archivalTimer = setInterval(() => void runDataArchival(), ARCHIVAL_INTERVAL_MS);
  for (const t of [
    otpTimer,
    reconcileTimer,
    assignmentTimer,
    financeReconcileTimer,
    integrityTimer,
    settlementSyncTimer,
    backupTimer,
    deletionTimer,
    alertEvalTimer,
    opsAlertDispatchTimer,
    archivalTimer,
    tokenCleanupTimer,
    retentionTickTimer,
    refundRetryTimer,
    aiBrainMaintenanceTimer,
  ]) {
    (t as { unref?: () => void }).unref?.();
  }
}

export function stopMaintenance(): void {
  stopOutboxProcessor();
  stopScheduledJobProcessor();
  stopEtlScheduler();
  for (const t of [
    otpTimer,
    reconcileTimer,
    assignmentTimer,
    financeReconcileTimer,
    integrityTimer,
    settlementSyncTimer,
    backupTimer,
    locationRetentionTimer,
    deletionTimer,
    alertEvalTimer,
    opsAlertDispatchTimer,
    archivalTimer,
    tokenCleanupTimer,
    retentionTickTimer,
    refundRetryTimer,
    aiBrainMaintenanceTimer,
  ]) {
    if (t) clearInterval(t);
  }
  otpTimer =
    reconcileTimer =
    assignmentTimer =
    financeReconcileTimer =
    integrityTimer =
    settlementSyncTimer =
    backupTimer =
    deletionTimer =
    alertEvalTimer =
    opsAlertDispatchTimer =
    archivalTimer =
    tokenCleanupTimer =
    retentionTickTimer =
    refundRetryTimer =
    aiBrainMaintenanceTimer =
      null;
}
