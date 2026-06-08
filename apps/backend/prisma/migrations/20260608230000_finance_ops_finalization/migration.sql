-- Finance Operations Finalization

ALTER TYPE "ChargebackStatus" ADD VALUE IF NOT EXISTS 'OPEN';
ALTER TYPE "ChargebackStatus" ADD VALUE IF NOT EXISTS 'EVIDENCE_PENDING';
ALTER TYPE "ChargebackStatus" ADD VALUE IF NOT EXISTS 'RESPONDED';

ALTER TABLE "chargebacks" ADD COLUMN IF NOT EXISTS "assigned_admin_id" TEXT;
ALTER TABLE "chargebacks" ADD COLUMN IF NOT EXISTS "response_text" TEXT;

DO $$ BEGIN
  CREATE TYPE "MigrationVerificationStatus" AS ENUM ('PASS', 'FAIL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SettlementSyncStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SettlementDiscrepancyType" AS ENUM ('MISSING_PAYMENT', 'AMOUNT_MISMATCH', 'DUPLICATE_SETTLEMENT', 'UNKNOWN_SETTLEMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinancialIntegrityStatus" AS ENUM ('PASS', 'FAIL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinanceAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "migration_verification_runs" (
    "id" TEXT NOT NULL,
    "status" "MigrationVerificationStatus" NOT NULL,
    "applied_count" INTEGER NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "drift_detected" BOOLEAN NOT NULL DEFAULT false,
    "rollback_risk" BOOLEAN NOT NULL DEFAULT false,
    "schema_checksum" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "migration_verification_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "settlement_sync_runs" (
    "id" TEXT NOT NULL,
    "status" "SettlementSyncStatus" NOT NULL DEFAULT 'STARTED',
    "settlements_synced" INTEGER NOT NULL DEFAULT 0,
    "discrepancies_found" INTEGER NOT NULL DEFAULT 0,
    "accuracy_pct" DOUBLE PRECISION,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "settlement_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "settlement_discrepancies" (
    "id" TEXT NOT NULL,
    "sync_run_id" TEXT NOT NULL,
    "type" "SettlementDiscrepancyType" NOT NULL,
    "reference_id" TEXT,
    "expected_amount" DOUBLE PRECISION,
    "actual_amount" DOUBLE PRECISION,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_discrepancies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "financial_integrity_runs" (
    "id" TEXT NOT NULL,
    "status" "FinancialIntegrityStatus" NOT NULL,
    "issues_count" INTEGER NOT NULL DEFAULT 0,
    "report" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_integrity_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "finance_alerts" (
    "id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" "FinanceAlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "finance_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "migration_verification_runs_status_idx" ON "migration_verification_runs"("status");
CREATE INDEX IF NOT EXISTS "migration_verification_runs_created_at_idx" ON "migration_verification_runs"("created_at");
CREATE INDEX IF NOT EXISTS "settlement_sync_runs_status_idx" ON "settlement_sync_runs"("status");
CREATE INDEX IF NOT EXISTS "settlement_sync_runs_started_at_idx" ON "settlement_sync_runs"("started_at");
CREATE INDEX IF NOT EXISTS "settlement_discrepancies_sync_run_id_idx" ON "settlement_discrepancies"("sync_run_id");
CREATE INDEX IF NOT EXISTS "settlement_discrepancies_type_idx" ON "settlement_discrepancies"("type");
CREATE INDEX IF NOT EXISTS "settlement_discrepancies_resolved_idx" ON "settlement_discrepancies"("resolved");
CREATE INDEX IF NOT EXISTS "financial_integrity_runs_status_idx" ON "financial_integrity_runs"("status");
CREATE INDEX IF NOT EXISTS "financial_integrity_runs_created_at_idx" ON "financial_integrity_runs"("created_at");
CREATE INDEX IF NOT EXISTS "finance_alerts_alert_type_idx" ON "finance_alerts"("alert_type");
CREATE INDEX IF NOT EXISTS "finance_alerts_severity_idx" ON "finance_alerts"("severity");
CREATE INDEX IF NOT EXISTS "finance_alerts_resolved_idx" ON "finance_alerts"("resolved");
CREATE INDEX IF NOT EXISTS "finance_alerts_created_at_idx" ON "finance_alerts"("created_at");

DO $$ BEGIN
  ALTER TABLE "settlement_discrepancies" ADD CONSTRAINT "settlement_discrepancies_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "settlement_sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
