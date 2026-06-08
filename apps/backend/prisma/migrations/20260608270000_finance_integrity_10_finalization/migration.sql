-- Finance Integrity 10/10 — journal types + liability snapshots
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'WALLET_TRANSFER_OUT';
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'WALLET_TRANSFER_IN';
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'HCOIN_EARNED';
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'HCOIN_REDEEMED';
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'HCOIN_ADJUSTED';
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'PROVIDER_PAYOUT_REVERSAL';
ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'CASHBACK_REVERSAL';

CREATE TYPE "LiabilitySnapshotPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "finance_liability_snapshots" (
  "id" TEXT NOT NULL,
  "period" "LiabilitySnapshotPeriod" NOT NULL,
  "snapshot_date" DATE NOT NULL,
  "wallet_liability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gift_card_liability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cashback_liability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "refund_liability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payout_liability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "chargeback_exposure" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "settlement_pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hcoin_liability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "provider_payable" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_liabilities" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payload" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_liability_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finance_liability_snapshots_period_date_key"
  ON "finance_liability_snapshots"("period", "snapshot_date");

CREATE INDEX "finance_liability_snapshots_snapshot_date_idx"
  ON "finance_liability_snapshots"("snapshot_date");
