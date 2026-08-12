-- Enterprise operations: payout approval workflow + settlement resolution

-- PayoutBatchStatus: add UNDER_REVIEW, APPROVED, REJECTED
ALTER TYPE "PayoutBatchStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "PayoutBatchStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "PayoutBatchStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- Payout batch approval fields
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "submitted_by" TEXT;
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "approved_by" TEXT;
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "rejected_by" TEXT;
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);

-- Settlement resolution workflow
CREATE TYPE "SettlementResolutionStatus" AS ENUM ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'ESCALATED');

ALTER TABLE "settlement_discrepancies" ADD COLUMN IF NOT EXISTS "status" "SettlementResolutionStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "settlement_discrepancies" ADD COLUMN IF NOT EXISTS "assigned_to" TEXT;
ALTER TABLE "settlement_discrepancies" ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP(3);
ALTER TABLE "settlement_discrepancies" ADD COLUMN IF NOT EXISTS "first_approved_by" TEXT;
ALTER TABLE "settlement_discrepancies" ADD COLUMN IF NOT EXISTS "second_approved_by" TEXT;
ALTER TABLE "settlement_discrepancies" ADD COLUMN IF NOT EXISTS "resolution_notes" TEXT;
ALTER TABLE "settlement_discrepancies" ADD COLUMN IF NOT EXISTS "escalated_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "settlement_discrepancies_status_idx" ON "settlement_discrepancies"("status");

CREATE TABLE IF NOT EXISTS "settlement_resolution_notes" (
    "id" TEXT NOT NULL,
    "discrepancy_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_resolution_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "settlement_resolution_notes_discrepancy_id_created_at_idx" ON "settlement_resolution_notes"("discrepancy_id", "created_at");

ALTER TABLE "settlement_resolution_notes" ADD CONSTRAINT "settlement_resolution_notes_discrepancy_id_fkey" FOREIGN KEY ("discrepancy_id") REFERENCES "settlement_discrepancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
