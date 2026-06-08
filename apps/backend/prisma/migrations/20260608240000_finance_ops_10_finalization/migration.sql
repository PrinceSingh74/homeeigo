-- Finance Operations 10/10 Finalization

CREATE TYPE "RefundRequestStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "gateway_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "run_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "missing_local" INTEGER NOT NULL DEFAULT 0,
    "missing_gateway" INTEGER NOT NULL DEFAULT 0,
    "match_pct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "gateway_payments_fetched" INTEGER NOT NULL DEFAULT 0,
    "gateway_refunds_fetched" INTEGER NOT NULL DEFAULT 0,
    "gateway_settlements_fetched" INTEGER NOT NULL DEFAULT 0,
    "report" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gateway_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gateway_reconciliation_issues" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "issue_type" "ReconciliationStatus" NOT NULL,
    "gateway_reference" TEXT,
    "local_reference" TEXT,
    "expected_amount" DOUBLE PRECISION,
    "actual_amount" DOUBLE PRECISION,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gateway_reconciliation_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payout_batches" (
    "id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "processed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payout_batch_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "withdrawal_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payout_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payout_reconciliations" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "run_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "mismatched" INTEGER NOT NULL DEFAULT 0,
    "report" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payout_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refund_requests" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "reason_code" TEXT,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "review_notes" TEXT,
    "razorpay_refund_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refund_audits" (
    "id" TEXT NOT NULL,
    "refund_request_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refund_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financial_holds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "provider_id" TEXT,
    "wallet_frozen" BOOLEAN NOT NULL DEFAULT false,
    "withdrawals_frozen" BOOLEAN NOT NULL DEFAULT false,
    "payouts_frozen" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "case_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),
    CONSTRAINT "financial_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_event_dedup" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_event_dedup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payout_batches_batch_number_key" ON "payout_batches"("batch_number");
CREATE INDEX "gateway_reconciliation_runs_run_date_idx" ON "gateway_reconciliation_runs"("run_date");
CREATE INDEX "gateway_reconciliation_issues_run_id_idx" ON "gateway_reconciliation_issues"("run_id");
CREATE INDEX "gateway_reconciliation_issues_issue_type_idx" ON "gateway_reconciliation_issues"("issue_type");
CREATE INDEX "payout_batches_status_idx" ON "payout_batches"("status");
CREATE INDEX "payout_batches_created_at_idx" ON "payout_batches"("created_at");
CREATE UNIQUE INDEX "payout_batch_items_batch_id_withdrawal_id_key" ON "payout_batch_items"("batch_id", "withdrawal_id");
CREATE INDEX "payout_batch_items_withdrawal_id_idx" ON "payout_batch_items"("withdrawal_id");
CREATE INDEX "payout_reconciliations_batch_id_idx" ON "payout_reconciliations"("batch_id");
CREATE INDEX "refund_requests_payment_id_idx" ON "refund_requests"("payment_id");
CREATE INDEX "refund_requests_user_id_idx" ON "refund_requests"("user_id");
CREATE INDEX "refund_requests_status_idx" ON "refund_requests"("status");
CREATE INDEX "refund_audits_refund_request_id_idx" ON "refund_audits"("refund_request_id");
CREATE UNIQUE INDEX "financial_holds_user_id_key" ON "financial_holds"("user_id");
CREATE UNIQUE INDEX "financial_holds_provider_id_key" ON "financial_holds"("provider_id");
CREATE INDEX "financial_holds_user_id_idx" ON "financial_holds"("user_id");
CREATE INDEX "financial_holds_provider_id_idx" ON "financial_holds"("provider_id");
CREATE UNIQUE INDEX "webhook_event_dedup_event_id_key" ON "webhook_event_dedup"("event_id");
CREATE INDEX "webhook_event_dedup_event_type_idx" ON "webhook_event_dedup"("event_type");

ALTER TABLE "gateway_reconciliation_issues" ADD CONSTRAINT "gateway_reconciliation_issues_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "gateway_reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payout_batch_items" ADD CONSTRAINT "payout_batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payout_reconciliations" ADD CONSTRAINT "payout_reconciliations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refund_audits" ADD CONSTRAINT "refund_audits_refund_request_id_fkey" FOREIGN KEY ("refund_request_id") REFERENCES "refund_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
