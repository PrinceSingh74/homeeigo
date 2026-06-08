-- Finance Integrity 10/10 — referral ledger, adjustments, backfill, hcoin expiry

-- Journal types
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'HCOIN_EXPIRED';
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'REFERRAL_COMMISSION';

-- HCoin txn type
ALTER TYPE "HCoinTxnType" ADD VALUE IF NOT EXISTS 'EXPIRE';

-- Liability snapshot expansion
ALTER TABLE "finance_liability_snapshots"
  ADD COLUMN IF NOT EXISTS "referral_liability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "adjustment_liability" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Manual financial adjustments
CREATE TYPE "AdjustmentType" AS ENUM ('CREDIT', 'DEBIT', 'CORRECTION', 'WRITE_OFF', 'LIABILITY_ADJUSTMENT', 'LEDGER_FIX');
CREATE TYPE "AdjustmentDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED');

CREATE TABLE "financial_adjustments" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "type" "AdjustmentType" NOT NULL,
  "direction" "AdjustmentDirection" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "target_user_id" TEXT,
  "debit_account_code" TEXT,
  "credit_account_code" TEXT,
  "reason" TEXT NOT NULL,
  "supporting_notes" TEXT,
  "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "maker_id" TEXT NOT NULL,
  "approver_id" TEXT,
  "rejected_reason" TEXT,
  "journal_id" TEXT,
  "wallet_txn_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "executed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "financial_adjustments_reference_key" ON "financial_adjustments"("reference");
CREATE UNIQUE INDEX "financial_adjustments_idempotency_key_key" ON "financial_adjustments"("idempotency_key");
CREATE INDEX "financial_adjustments_status_idx" ON "financial_adjustments"("status");
CREATE INDEX "financial_adjustments_type_idx" ON "financial_adjustments"("type");
CREATE INDEX "financial_adjustments_target_user_id_idx" ON "financial_adjustments"("target_user_id");
CREATE INDEX "financial_adjustments_created_at_idx" ON "financial_adjustments"("created_at");

CREATE TABLE "financial_adjustment_approvals" (
  "id" TEXT NOT NULL,
  "adjustment_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_adjustment_approvals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "financial_adjustment_approvals_adjustment_id_idx" ON "financial_adjustment_approvals"("adjustment_id");
ALTER TABLE "financial_adjustment_approvals"
  ADD CONSTRAINT "financial_adjustment_approvals_adjustment_id_fkey"
  FOREIGN KEY ("adjustment_id") REFERENCES "financial_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Historical ledger backfill
CREATE TYPE "BackfillRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ledger_backfill_runs" (
  "id" TEXT NOT NULL,
  "types" TEXT NOT NULL,
  "status" "BackfillRunStatus" NOT NULL DEFAULT 'RUNNING',
  "records_scanned" INTEGER NOT NULL DEFAULT 0,
  "records_backfilled" INTEGER NOT NULL DEFAULT 0,
  "records_skipped" INTEGER NOT NULL DEFAULT 0,
  "records_failed" INTEGER NOT NULL DEFAULT 0,
  "started_by" TEXT,
  "report" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "ledger_backfill_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ledger_backfill_runs_status_idx" ON "ledger_backfill_runs"("status");
CREATE INDEX "ledger_backfill_runs_created_at_idx" ON "ledger_backfill_runs"("created_at");

CREATE TABLE "ledger_backfill_issues" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "backfill_type" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_backfill_issues_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ledger_backfill_issues_run_id_idx" ON "ledger_backfill_issues"("run_id");
CREATE INDEX "ledger_backfill_issues_backfill_type_idx" ON "ledger_backfill_issues"("backfill_type");
ALTER TABLE "ledger_backfill_issues"
  ADD CONSTRAINT "ledger_backfill_issues_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ledger_backfill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- H-Coin expiry
CREATE TABLE "hcoin_expiry_config" (
  "id" TEXT NOT NULL,
  "singleton" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "expiry_days" INTEGER NOT NULL DEFAULT 365,
  "last_run_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hcoin_expiry_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hcoin_expiry_config_singleton_key" ON "hcoin_expiry_config"("singleton");

CREATE TABLE "hcoin_expiry_runs" (
  "id" TEXT NOT NULL,
  "coins_expired" INTEGER NOT NULL DEFAULT 0,
  "wallets_affected" INTEGER NOT NULL DEFAULT 0,
  "rupee_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "started_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hcoin_expiry_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hcoin_expiry_runs_created_at_idx" ON "hcoin_expiry_runs"("created_at");
