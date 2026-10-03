import { spawn } from "child_process";
import path from "path";
import prisma from "./prisma";
import { OTPService } from "../services/otp.service";

import { bookingIdempotencyService } from "../services/booking-idempotency.service";
import { bookingPaymentExpiryService } from "../services/booking-payment-expiry.service";
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
import { incCounter } from "./metrics";
import { markBootDegraded } from "./boot-health";
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
import { refundAutoRecoveryDecision } from "./refund-recovery-guard";
import { maintenanceWriteDecision } from "./maintenance-target-guard";
import { financialLedgerService } from "../services/financial-ledger.service";
import { partnerIncentivePayoutService } from "../services/partner-incentive-payout.service";
import { startOutboxProcessor, stopOutboxProcessor } from "../events/core/outbox-processor";
import { startScheduledJobProcessor, stopScheduledJobProcessor } from "../events/core/job-processor";
import { bootstrapScheduledJobs } from "../events/jobs";
import { bootstrapWorkflows } from "../automation/registry/definitions";
import { cleanupEventPlatformData } from "../events/core/retention";
import { startEtlScheduler, stopEtlScheduler } from "../../analytics/scheduler/etl-scheduler";
import { expireStaleMemories, purgeExpiredContextCache } from "../ai-brain";

const AI_BRAIN_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const INCENTIVE_EVAL_INTERVAL_MS = 60 * 60 * 1000;

const OTP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ASSIGNMENT_INTERVAL_MS = 30 * 1000;
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
/**
 * A 15-minute TTL checked every minute: the worst case a customer or partner sees is a slot held
 * ~16 minutes, not ~30. The sweep is a single bounded query when there is nothing to do.
 */
const PAYMENT_EXPIRY_INTERVAL_MS = 60 * 1000;
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
const COMPLIANCE_EXPIRY_INTERVAL_MS = 60 * 60 * 1000;
const PARTNER_SCORE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/**
 * Phase 10 §10: a completion whose confirmation window closed is AUTO_CONFIRMED at most ~10 minutes
 * late. The sweep is one bounded SKIP LOCKED query when there is nothing due.
 */
const COMPLETION_AUTO_CONFIRM_INTERVAL_MS = 10 * 60 * 1000;
/**
 * Half the stale threshold, so a partner never sits stale for a full window before the
 * gauges and events notice. Faster than this only adds reads without changing any decision:
 * dispatch already derives freshness at read time and never waits for this sweep.
 */
const PRESENCE_SWEEP_INTERVAL_MS = 30 * 1000;

let locationRetentionTimer: ReturnType<typeof setInterval> | null = null;
let otpTimer: ReturnType<typeof setInterval> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let paymentExpiryTimer: ReturnType<typeof setInterval> | null = null;
let backupTimer: ReturnType<typeof setInterval> | null = null;
let deletionTimer: ReturnType<typeof setInterval> | null = null;
let assignmentTimer: ReturnType<typeof setInterval> | null = null;
let presenceSweepTimer: ReturnType<typeof setInterval> | null = null;
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
let incentiveEvalTimer: ReturnType<typeof setInterval> | null = null;
let complianceExpiryTimer: ReturnType<typeof setInterval> | null = null;
let partnerScoreTimer: ReturnType<typeof setInterval> | null = null;
let completionAutoConfirmTimer: ReturnType<typeof setInterval> | null = null;

const otpService = new OTPService(prisma);
const refreshTokenService = new RefreshTokenService(prisma, new JWTService());

async function runOtpCleanup(): Promise<void> {
  await runWithLeaderLock("maintenance:otp_cleanup", 300, async () => {
    const expired = await otpService.deleteExpiredOTPs();
    const usedOld = await otpService.deleteOldUsedOTPs();
    if (expired + usedOld > 0) {
      logger.info("otp_cleanup", { category: "APPLICATION", expired, usedOld });
    }
    // Phase 09: idempotency records expire the same way OTPs do — rides the same tick and lock.
    // The table only ever holds keys that clients actually sent, and the sweep is what keeps it
    // bounded; a bookkeeping table that is "usually small" is not the same as one that cannot grow.
    const idempotencyKeys = await bookingIdempotencyService.sweepExpired();
    if (idempotencyKeys > 0) {
      logger.info("booking_idempotency_sweep", { category: "APPLICATION", deleted: idempotencyKeys });
    }
  });
}

/**
 * ── OWNER DECISION REQUIRED: automatic refund recovery is OFF unless explicitly enabled ─────────
 *
 * The two recovery sweeps below act on money without a human: stale-refund recovery asks the gateway
 * what it holds and can resolve a refund to FAILED (which the retry scan then re-issues), and the
 * stranded-cancellation sweep starts refunds that never began — through the real gateway for
 * gateway-paid bookings. That is the intended behaviour of a deployed system.
 *
 * It is NOT safe by default here. Local development servers run this file against homigo_db with the
 * Razorpay keys in `.env`, and on 2026-09-19 a watch-mode dev server hot-loaded the new sweep and began
 * claiming historical INDETERMINATE refunds in that database and querying the gateway about them. So
 * the sweeps run only when `refundAutoRecoveryDecision` allows it (read every tick): the flag
 * REFUND_AUTO_RECOVERY_ENABLED=true, AND either a test database or a production runtime whose
 * REFUND_AUTO_RECOVERY_AUTHORIZED_TARGET names this exact database. A dotenv line alone cannot enable it
 * against homigo_db. The retry of already-FAILED cancellation refunds is pre-existing and unchanged.
 */
let lastRecoveryDecision = "";
function refundAutoRecoveryEnabled(): boolean {
  // The flag alone is not enough: see refund-recovery-guard for why a live database target needs an
  // explicit, target-specific authorization in a production runtime.
  const decision = refundAutoRecoveryDecision();
  const summary = `${decision.enabled}:${decision.reason}:${decision.target ?? "-"}`;
  if (summary !== lastRecoveryDecision) {
    lastRecoveryDecision = summary;
    logger.info("refund_auto_recovery_decision", { category: "PAYMENT", ...decision });
  }
  return decision.enabled;
}

async function runRefundRetry(): Promise<void> {
  await runWithLeaderLock("maintenance:refund_retry", 240, async () => {
    const autoRecovery = refundAutoRecoveryEnabled();
    // Order matters: settling a stale gateway attempt can turn it FAILED, which the retry scan then
    // re-attempts under the same operation key in this same tick.
    if (autoRecovery) {
      const stale = await bookingRefundService.recoverStaleGatewayRefunds(25);
      if (stale.scanned > 0) {
        logger.info("refund_stale_recovery", { category: "PAYMENT", ...stale });
      }
    }
    const result = await bookingRefundService.retryFailedRefunds(25);
    if (result.succeeded > 0) {
      logger.info("refund_retry", { category: "PAYMENT", ...result });
    }
    // A cancellation whose refund never started (the process died after the cancel committed) has no
    // refund request at all; its committed booking row is the intent this scan finishes.
    if (autoRecovery) {
      const stranded = await bookingRefundService.recoverStrandedCancellationRefunds(25);
      if (stranded.scanned > 0) {
        logger.info("refund_stranded_recovery", { category: "PAYMENT", ...stranded });
      }
      // A split whose captured gateway leg must be returned (wallet share could not be charged).
      const { walletCheckoutService } = await import("../services/wallet-checkout.service");
      const shortfall = await walletCheckoutService.recoverSplitShortfallRefunds(25);
      if (shortfall.scanned > 0) {
        logger.info("refund_split_shortfall_recovery", { category: "PAYMENT", ...shortfall });
      }
    }
  }, { exclusive: true });
}

/**
 * PAYMENT_PENDING_TTL (owner decision 2026-09-23: 15 minutes). Its own tick and lock: expiry must
 * keep running at a fixed cadence even when the slower gateway reconciliation is busy or failing.
 */
async function runPaymentExpiry(): Promise<void> {
  await runWithLeaderLock("maintenance:payment_expiry", 120, async () => {
    const r = await bookingPaymentExpiryService.expireStalePendingPayments();
    if (r.expired > 0 || r.skipped > 0) {
      logger.info("booking_payment_expiry", {
        category: "PAYMENT",
        scanned: r.scanned,
        expired: r.expired,
        skipped: r.skipped,
        pastDatedBacklog: r.pastDatedBacklog,
      });
    }
  }, { exclusive: true });
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
  }, { exclusive: true });
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

/**
 * Upper bound for one scheduled backup, derived from a MEASURED run rather than a guess: a real
 * 58.56 MB dump (pg_dump + pg_restore verification + sha256 + S3 upload to eu-north-1 + GFS
 * retention) completed in **18.4 s**. 15 minutes is ~50x that headroom — generous for database
 * growth and a slow offsite upload, yet far below the 1-hour tick, so a hung run can never still
 * be holding the lock when the next one is due.
 */
const BACKUP_TIMEOUT_MS = Number(process.env.BACKUP_TIMEOUT_MS || 15 * 60 * 1000);

async function runBackup(): Promise<void> {
  if (process.env.ENABLE_SCHEDULED_BACKUPS !== "true") return;
  await runWithLeaderLock("maintenance:db_backup", 3600, async () => {
    const script = path.join(process.cwd(), "scripts", "backup-db.ts");
    const startedAt = Date.now();

    /**
     * Awaited on purpose — three real defects lived in the previous fire-and-forget version:
     *
     *  1. NO TIMEOUT. A stalled `pg_dump` (a network partition to Postgres, a `docker exec` that
     *     never returns) ran forever, holding a child process indefinitely.
     *  2. THE LEADER LOCK DID NOT COVER THE BACKUP. `spawn()` returns immediately, so the lock was
     *     released the instant the process was launched rather than when the backup finished —
     *     the very duplicate-prevention the lock exists for did not apply to the work itself.
     *  3. SILENT FAILURE. Only `.on("error")` (spawn-level failure) was handled. A backup that ran
     *     but exited non-zero — pg_dump failed, integrity verification failed — was logged
     *     nowhere, so a broken backup looked exactly like a working one.
     */
    await new Promise<void>((resolve) => {
      /**
       * `shell` is deliberately NOT set.
       *
       * It used to be `shell: process.platform === "win32"`, which silently broke the backup on
       * any Windows host where the Bun executable lives under a path containing a space — the
       * common case, e.g. `C:\Users\First Last\AppData\Roaming\npm\...\bun.exe`. With `shell:true`
       * Node concatenates argv without quoting, so cmd.exe split the path and answered
       * `'C:\Users\First' is not recognized as an internal or external command` and the child
       * exited 1 **without ever running pg_dump**. Reproduced directly on this machine.
       *
       * Combined with the old fire-and-forget spawn (no exit-code handling), that produced the
       * worst possible outcome: a backup that never ran, reported as nothing at all. No shell is
       * needed here — `process.execPath` is an absolute path to a real executable.
       */
      const child = spawn(process.execPath, ["run", script], {
        stdio: "inherit",
        env: process.env,
      });

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        if (settled) return;
        incCounter("db_backup_total", { result: "timeout" });
        logger.error("backup_timeout", {
          category: "APPLICATION",
          timeoutMs: BACKUP_TIMEOUT_MS,
          elapsedMs: Date.now() - startedAt,
        });
        // SIGTERM first so pg_dump can clean up its partial file; SIGKILL only if it ignores that.
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 10_000).unref?.();
        finish();
      }, BACKUP_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();

      child.on("error", (e) => {
        incCounter("db_backup_total", { result: "spawn_error" });
        logger.error("backup_failed", {
          category: "APPLICATION",
          reason: "spawn_error",
          error: e.message,
          elapsedMs: Date.now() - startedAt,
        });
        finish();
      });

      child.on("close", (code, signal) => {
        if (settled) return;
        const elapsedMs = Date.now() - startedAt;
        if (code === 0) {
          incCounter("db_backup_total", { result: "success" });
          logger.info("backup_completed", { category: "APPLICATION", elapsedMs });
        } else {
          // A non-zero exit is a REAL failure (pg_dump error, integrity verification failure) and
          // must never be mistaken for a completed backup.
          incCounter("db_backup_total", { result: "failed" });
          logger.error("backup_failed", {
            category: "APPLICATION",
            reason: "nonzero_exit",
            exitCode: code,
            signal,
            elapsedMs,
          });
        }
        finish();
      });
    });
  }, { exclusive: true });
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

/**
 * Detect partners whose liveness evidence went stale. Leader-locked so a multi-node
 * deployment emits one event per degradation, not one per node.
 */
async function runPresenceSweep(): Promise<void> {
  try {
    await runWithLeaderLock("maintenance:presence_sweep", 60, async () => {
      const { sweepStalePresence } = await import("../services/partner-presence-monitor.service");
      await sweepStalePresence();
    });
  } catch (err) {
    logger.warn("presence_sweep_skipped", {
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

async function runPartnerIncentiveEvaluation(): Promise<void> {
  await runWithLeaderLock("maintenance:partner_incentive_eval", 1800, async () => {
    const result = await partnerIncentivePayoutService.evaluateRecentActiveProviders();
    if (result.credited > 0) {
      logger.info("partner_incentive_eval", {
        category: "FINANCE",
        providers: result.providers,
        credited: result.credited,
      });
    }
  }, { exclusive: true });
}

async function runPartnerScoreRefresh(): Promise<void> {
  await runWithLeaderLock("maintenance:partner_score_refresh", 1800, async () => {
    const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stale = await prisma.provider.findMany({
      where: {
        isApproved: true,
        OR: [{ unifiedScore: { is: null } }, { unifiedScore: { calculatedAt: { lt: staleBefore } } }],
      },
      select: { id: true },
      take: 40,
    });
    if (stale.length === 0) return;
    const { partnerScoreService } = await import("../services/partner-score.service");
    for (const p of stale) {
      await partnerScoreService.recalculate(p.id).catch(() => undefined);
    }
    logger.info("partner_score_refresh", { category: "APPLICATION", refreshed: stale.length });
  });
}

async function runComplianceExpiry(): Promise<void> {
  await runWithLeaderLock("maintenance:compliance_expiry", 1800, async () => {
    const { complianceExpiryService } = await import("../services/compliance-expiry.service");
    const result = await complianceExpiryService.evaluateAll();
    if (result.reminders + result.expired + result.restricted > 0) {
      logger.info("compliance_expiry_maintenance", { category: "APPLICATION", ...result });
    }
  }, { exclusive: true });
  // Phase 10 §11: ACTIVE warranties past expires_at become EXPIRED (a writing sweep; same hourly tick,
  // same autonomous gate). Eligibility already refuses by date — this makes the row say so.
  await runWithLeaderLock("maintenance:warranty_expiry", 1800, async () => {
    const { bookingCaseService } = await import("../services/booking-case.service");
    const r = await bookingCaseService.expireWarranties();
    if (r.expired > 0) logger.info("warranty_expiry_maintenance", { category: "APPLICATION", ...r });
  }, { exclusive: true });
}

/**
 * Phase 10 §10: PENDING_CUSTOMER completions whose confirm_by has passed become AUTO_CONFIRMED by
 * SYSTEM — a recorded resolution (audit row, outbox event, one inbox message), never a silent one.
 * A writing sweep: autonomous gate + exclusive leader lock, like the warranty-expiry sweep above.
 * Without booking_completions deployed the service answers {confirmed: 0} and nothing is touched.
 */
async function runCompletionAutoConfirm(): Promise<void> {
  await runWithLeaderLock("maintenance:completion_auto_confirm", 600, async () => {
    const { bookingCompletionService } = await import("../services/booking-completion.service");
    const r = await bookingCompletionService.autoConfirmDue();
    if (r.confirmed > 0) logger.info("completion_auto_confirm_maintenance", { category: "APPLICATION", confirmed: r.confirmed });
  }, { exclusive: true });
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
        /**
         * Backfill missing journals (safe: derived from operational rows that already exist) but
         * NEVER auto-post balancing adjustments here. Posting ADJUSTMENT_CLEARING journals until
         * ledger == SUM(wallet) absorbed every bypass in the money paths within one tick, so the
         * WALLET_LIABILITY_MISMATCH signal could not stay red — a control that cannot fire.
         * Drift is now surfaced (metric + error log) and left for an operator to reconcile via
         * the explicit admin endpoint, where the adjustment is a deliberate, audited act.
         */
        const reconciled = await ledgerReconciliationService.reconcile({ backfillLimit: 2000, postAdjustments: false });
        incCounter("financial_liability_drift_total");
        logger.error("ledger_liability_drift_detected", {
          category: "FINANCE",
          maxDelta: reconciled.maxDelta,
          issues: result.issues
            .filter((i) => ["WALLET_LIABILITY_MISMATCH", "PROVIDER_PAYABLE_MISMATCH", "HCOIN_LIABILITY_MISMATCH"].includes(i.category))
            .map((i) => ({ category: i.category, details: i.details })),
        });
      }
    }
    await financeLiabilityService.captureSnapshot("DAILY").catch(() => undefined);
  });
}

/** Startup integrity gate — logs CRITICAL failures; blocks prod boot when configured. */
export async function runStartupFinancialIntegrity(): Promise<void> {
  await financialLedgerService.ensureAccountsSeeded();
  // The integrity run writes a run row (and can trigger reconciliation): autonomous maintenance.
  if (!maintenanceWriteDecision().enabled) return;
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
    // Backfill only; see runFinancialIntegrity for why adjustments are never auto-posted.
    const reconciled = await ledgerReconciliationService.reconcile({ backfillLimit: 3000, postAdjustments: false });
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
  }, { exclusive: true });
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
  bootstrapScheduledJobs();

  /**
   * Runtime vs autonomous maintenance — see maintenance-target-guard. Everything below the runtime
   * block runs on its own and writes (ledger, money, deletions, bookkeeping). It is registered only when
   * the database target allows it: a dev server whose `.env` points at homigo_db keeps serving requests
   * and delivering events, but maintains nothing.
   */
  const decision = maintenanceWriteDecision();
  logger.info("maintenance_target_decision", { category: "APPLICATION", ...decision });
  if (!decision.enabled && decision.degradeBoot) {
    markBootDegraded(
      "maintenance",
      new Error(decision.reason),
      `autonomous maintenance NOT started for ${decision.target ?? "an unreadable DATABASE_URL"}: set MAINTENANCE_AUTHORIZED_TARGET to this database's host:port/name`,
    );
  }
  /**
   * Workflow definitions must be in the in-memory registry before the outbox or
   * job processor can run. `bootstrapWorkflows` is async (certification + DB
   * sync). Starting processors in the same tick as a fire-and-forget bootstrap
   * lets due `automation.workflow_step` jobs (and new trigger events) execute
   * against an empty registry → `No code for partner_lead_intake.v1 in this process`.
   */
  void (async () => {
    try {
      await bootstrapWorkflows();
    } catch (err) {
      logger.error("workflow_bootstrap_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      /**
       * Not starting the processors is the right call (see above) — but it must not be a quiet
       * one. Recording the degradation flips `/ready` to 503 so the outage is externally
       * visible instead of surfacing days later as "why did no event get delivered".
       */
      markBootDegraded(
        "workflow_registry",
        err,
        "outbox and scheduled-job processors NOT started: events publish but are never delivered; automations never run",
      );
      return;
    }
    startOutboxProcessor();
    startScheduledJobProcessor();
  })();
  // ── runtime: the request path depends on these ──
  void runAssignmentDispatch();
  void runPresenceSweep();
  assignmentTimer = setInterval(() => void runAssignmentDispatch(), ASSIGNMENT_INTERVAL_MS);
  presenceSweepTimer = setInterval(() => void runPresenceSweep(), PRESENCE_SWEEP_INTERVAL_MS);
  (assignmentTimer as { unref?: () => void }).unref?.();
  (presenceSweepTimer as { unref?: () => void }).unref?.();
  if (!decision.enabled) {
    logger.warn("maintenance_autonomous_jobs_disabled", {
      category: "APPLICATION",
      reason: decision.reason,
      target: decision.target,
      skipped: [
        "etl", "otp_cleanup", "payment_reconcile", "finance_reconcile", "financial_integrity", "alert_evaluation",
        "ops_alert_dispatch", "token_cleanup", "retention", "ai_brain", "refund_retry", "incentive_eval",
        "compliance_expiry", "warranty_expiry", "completion_auto_confirm", "partner_score", "settlement_sync", "backup", "location_retention",
        "deletion_finalize", "data_archival",
      ],
    });
    return;
  }

  // ── autonomous: runs on its own and writes; only where the target allows it ──
  void bootstrapRetention().catch(() => undefined);
  startEtlScheduler();
  void runOtpCleanup();
  void runReconcile();
  void runPaymentExpiry();
  void runFinanceReconciliation();
  void runFinancialIntegrity();
  void runAlertEvaluation();
  void runOpsAlertDispatch();
  void runTokenSecurityCleanup();
  void runRetentionTick();
  void runAiBrainMaintenance();
  void runRefundRetry();
  void runPartnerIncentiveEvaluation();
  void runComplianceExpiry();
  void runCompletionAutoConfirm();
  otpTimer = setInterval(() => void runOtpCleanup(), OTP_INTERVAL_MS);
  refundRetryTimer = setInterval(() => void runRefundRetry(), REFUND_RETRY_INTERVAL_MS);
  aiBrainMaintenanceTimer = setInterval(() => void runAiBrainMaintenance(), AI_BRAIN_MAINTENANCE_INTERVAL_MS);
  retentionTickTimer = setInterval(() => void runRetentionTick(), RETENTION_TICK_INTERVAL_MS);
  tokenCleanupTimer = setInterval(() => void runTokenSecurityCleanup(), TOKEN_CLEANUP_INTERVAL_MS);
  reconcileTimer = setInterval(() => void runReconcile(), RECONCILE_INTERVAL_MS);
  paymentExpiryTimer = setInterval(() => void runPaymentExpiry(), PAYMENT_EXPIRY_INTERVAL_MS);
  financeReconcileTimer = setInterval(() => void runFinanceReconciliation(), FINANCE_RECONCILE_INTERVAL_MS);
  integrityTimer = setInterval(() => void runFinancialIntegrity(), INTEGRITY_INTERVAL_MS);
  incentiveEvalTimer = setInterval(() => void runPartnerIncentiveEvaluation(), INCENTIVE_EVAL_INTERVAL_MS);
  complianceExpiryTimer = setInterval(() => void runComplianceExpiry(), COMPLIANCE_EXPIRY_INTERVAL_MS);
  partnerScoreTimer = setInterval(() => void runPartnerScoreRefresh(), PARTNER_SCORE_REFRESH_INTERVAL_MS);
  completionAutoConfirmTimer = setInterval(() => void runCompletionAutoConfirm(), COMPLETION_AUTO_CONFIRM_INTERVAL_MS);
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
    presenceSweepTimer,
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
    incentiveEvalTimer,
    complianceExpiryTimer,
    partnerScoreTimer,
    completionAutoConfirmTimer,
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
    paymentExpiryTimer,
    assignmentTimer,
    presenceSweepTimer,
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
    incentiveEvalTimer,
    complianceExpiryTimer,
    partnerScoreTimer,
    completionAutoConfirmTimer,
  ]) {
    if (t) clearInterval(t);
  }
  otpTimer =
    reconcileTimer =
    paymentExpiryTimer =
    assignmentTimer =
    presenceSweepTimer =
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
    incentiveEvalTimer =
    complianceExpiryTimer =
    partnerScoreTimer =
    completionAutoConfirmTimer =
      null;
}
