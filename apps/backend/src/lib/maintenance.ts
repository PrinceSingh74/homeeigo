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
import { financeLiabilityService } from "../services/finance-liability.service";
import { settlementSyncService } from "../services/settlement-sync.service";
import { runWithLeaderLock } from "./distributed-scheduler";
import { alertEvaluatorService } from "../services/alert-evaluator.service";
import { dataArchivalService } from "../services/data-archival.service";
import { logger } from "./logger";

const OTP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ASSIGNMENT_INTERVAL_MS = 30 * 1000;
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
const FINANCE_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INTEGRITY_INTERVAL_MS = 60 * 60 * 1000;
const SETTLEMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DELETION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ALERT_EVAL_INTERVAL_MS = 5 * 60 * 1000;
const ARCHIVAL_INTERVAL_MS = 24 * 60 * 60 * 1000;

let otpTimer: ReturnType<typeof setInterval> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let backupTimer: ReturnType<typeof setInterval> | null = null;
let deletionTimer: ReturnType<typeof setInterval> | null = null;
let assignmentTimer: ReturnType<typeof setInterval> | null = null;
let financeReconcileTimer: ReturnType<typeof setInterval> | null = null;
let integrityTimer: ReturnType<typeof setInterval> | null = null;
let settlementSyncTimer: ReturnType<typeof setInterval> | null = null;
let alertEvalTimer: ReturnType<typeof setInterval> | null = null;
let archivalTimer: ReturnType<typeof setInterval> | null = null;

const otpService = new OTPService(prisma);

async function runOtpCleanup(): Promise<void> {
  await runWithLeaderLock("maintenance:otp_cleanup", 300, async () => {
    const expired = await otpService.deleteExpiredOTPs();
    const usedOld = await otpService.deleteOldUsedOTPs();
    if (expired + usedOld > 0) {
      logger.info("otp_cleanup", { category: "APPLICATION", expired, usedOld });
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
    }
    await financeLiabilityService.captureSnapshot("DAILY").catch(() => undefined);
  });
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

async function runDataArchival(): Promise<void> {
  await runWithLeaderLock("maintenance:data_archival", 3600, async () => {
    await dataArchivalService.runArchival();
  });
}

export function startMaintenance(): void {
  if (otpTimer) return;
  void consentService.ensurePolicyVersionsSeeded().catch(() => undefined);
  void runOtpCleanup();
  void runReconcile();
  void runAssignmentDispatch();
  void runFinanceReconciliation();
  void runFinancialIntegrity();
  void runAlertEvaluation();
  otpTimer = setInterval(() => void runOtpCleanup(), OTP_INTERVAL_MS);
  reconcileTimer = setInterval(() => void runReconcile(), RECONCILE_INTERVAL_MS);
  assignmentTimer = setInterval(() => void runAssignmentDispatch(), ASSIGNMENT_INTERVAL_MS);
  financeReconcileTimer = setInterval(() => void runFinanceReconciliation(), FINANCE_RECONCILE_INTERVAL_MS);
  integrityTimer = setInterval(() => void runFinancialIntegrity(), INTEGRITY_INTERVAL_MS);
  settlementSyncTimer = setInterval(() => void runSettlementSync(), SETTLEMENT_SYNC_INTERVAL_MS);
  backupTimer = setInterval(() => void runBackup(), BACKUP_INTERVAL_MS);
  deletionTimer = setInterval(() => void runDeletionFinalize(), DELETION_INTERVAL_MS);
  alertEvalTimer = setInterval(() => void runAlertEvaluation(), ALERT_EVAL_INTERVAL_MS);
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
    archivalTimer,
  ]) {
    (t as { unref?: () => void }).unref?.();
  }
}

export function stopMaintenance(): void {
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
    archivalTimer,
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
    archivalTimer =
      null;
}
