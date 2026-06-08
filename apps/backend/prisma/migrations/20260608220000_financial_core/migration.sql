-- Enterprise Financial Core (Phases 3-8)

-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settled_amount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "settlement_batches" ADD COLUMN IF NOT EXISTS "net_amount" DOUBLE PRECISION;
ALTER TABLE "settlement_batches" ADD COLUMN IF NOT EXISTS "gateway_reference" TEXT;

-- AlterTable
ALTER TABLE "chargebacks" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "chargebacks" ADD COLUMN IF NOT EXISTS "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "chargebacks" ADD COLUMN IF NOT EXISTS "response_deadline" TIMESTAMP(3);

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'MISSING_LOCAL', 'MISSING_GATEWAY', 'REFUND_MISMATCH', 'SETTLEMENT_MISMATCH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinancialRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_settlements" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "settlement_batch_id" TEXT,
    "razorpay_payment_id" TEXT,
    "settlement_id" TEXT NOT NULL,
    "settled_amount" DOUBLE PRECISION NOT NULL,
    "settled_at" TIMESTAMP(3) NOT NULL,
    "gateway_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "settlement_line_items" (
    "id" TEXT NOT NULL,
    "settlement_batch_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "razorpay_payment_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_line_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_reconciliations" (
    "id" TEXT NOT NULL,
    "run_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'MATCHED',
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "missing_local" INTEGER NOT NULL DEFAULT 0,
    "missing_gateway" INTEGER NOT NULL DEFAULT 0,
    "match_pct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "reconciliation_issues" (
    "id" TEXT NOT NULL,
    "reconciliation_id" TEXT NOT NULL,
    "issue_type" "ReconciliationStatus" NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "expected_amount" DOUBLE PRECISION,
    "actual_amount" DOUBLE PRECISION,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ledger_balance_snapshots" (
    "id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_balance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payout_attempts" (
    "id" TEXT NOT NULL,
    "withdrawal_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "razorpay_payout_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payout_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chargeback_evidence" (
    "id" TEXT NOT NULL,
    "chargeback_id" TEXT NOT NULL,
    "file_url" TEXT,
    "description" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chargeback_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chargeback_timeline" (
    "id" TEXT NOT NULL,
    "chargeback_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chargeback_timeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "financial_risk_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "severity" "FinancialRiskLevel" NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_risk_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "financial_fraud_cases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "category" TEXT NOT NULL,
    "severity" "FinancialRiskLevel" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_fraud_cases_pkey" PRIMARY KEY ("id")
);

-- Indexes & FKs
CREATE UNIQUE INDEX IF NOT EXISTS "payment_settlements_payment_id_settlement_id_key" ON "payment_settlements"("payment_id", "settlement_id");
CREATE INDEX IF NOT EXISTS "payment_settlements_settlement_id_idx" ON "payment_settlements"("settlement_id");
CREATE INDEX IF NOT EXISTS "payment_settlements_settled_at_idx" ON "payment_settlements"("settled_at");

CREATE INDEX IF NOT EXISTS "settlement_line_items_settlement_batch_id_idx" ON "settlement_line_items"("settlement_batch_id");
CREATE INDEX IF NOT EXISTS "settlement_line_items_payment_id_idx" ON "settlement_line_items"("payment_id");

CREATE INDEX IF NOT EXISTS "payment_reconciliations_run_date_idx" ON "payment_reconciliations"("run_date");
CREATE INDEX IF NOT EXISTS "payment_reconciliations_status_idx" ON "payment_reconciliations"("status");

CREATE INDEX IF NOT EXISTS "reconciliation_issues_reconciliation_id_idx" ON "reconciliation_issues"("reconciliation_id");
CREATE INDEX IF NOT EXISTS "reconciliation_issues_issue_type_idx" ON "reconciliation_issues"("issue_type");

CREATE UNIQUE INDEX IF NOT EXISTS "ledger_balance_snapshots_journal_id_account_id_key" ON "ledger_balance_snapshots"("journal_id", "account_id");
CREATE INDEX IF NOT EXISTS "ledger_balance_snapshots_account_id_idx" ON "ledger_balance_snapshots"("account_id");

CREATE INDEX IF NOT EXISTS "payout_attempts_withdrawal_id_idx" ON "payout_attempts"("withdrawal_id");

CREATE INDEX IF NOT EXISTS "chargeback_evidence_chargeback_id_idx" ON "chargeback_evidence"("chargeback_id");
CREATE INDEX IF NOT EXISTS "chargeback_timeline_chargeback_id_idx" ON "chargeback_timeline"("chargeback_id");

CREATE INDEX IF NOT EXISTS "financial_risk_events_user_id_idx" ON "financial_risk_events"("user_id");
CREATE INDEX IF NOT EXISTS "financial_risk_events_event_type_idx" ON "financial_risk_events"("event_type");
CREATE INDEX IF NOT EXISTS "financial_risk_events_severity_idx" ON "financial_risk_events"("severity");

CREATE INDEX IF NOT EXISTS "financial_fraud_cases_user_id_idx" ON "financial_fraud_cases"("user_id");
CREATE INDEX IF NOT EXISTS "financial_fraud_cases_category_idx" ON "financial_fraud_cases"("category");
CREATE INDEX IF NOT EXISTS "financial_fraud_cases_status_idx" ON "financial_fraud_cases"("status");

DO $$ BEGIN
  ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "settlement_line_items" ADD CONSTRAINT "settlement_line_items_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "payment_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ledger_balance_snapshots" ADD CONSTRAINT "ledger_balance_snapshots_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ledger_balance_snapshots" ADD CONSTRAINT "ledger_balance_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "chargeback_evidence" ADD CONSTRAINT "chargeback_evidence_chargeback_id_fkey" FOREIGN KEY ("chargeback_id") REFERENCES "chargebacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "chargeback_timeline" ADD CONSTRAINT "chargeback_timeline_chargeback_id_fkey" FOREIGN KEY ("chargeback_id") REFERENCES "chargebacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
