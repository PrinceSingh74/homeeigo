-- P4 Part B+C: Retention automation + compliance framework

CREATE TYPE "retention_job_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "compliance_request_type" AS ENUM ('EXPORT', 'DELETE', 'CORRECTION', 'ACCESS', 'RESTRICT', 'OBJECT');
CREATE TYPE "compliance_request_status" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'EXPIRED');
CREATE TYPE "export_status" AS ENUM ('PENDING', 'GENERATING', 'READY', 'DOWNLOADED', 'EXPIRED');
CREATE TYPE "compliance_deletion_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED');

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "notifications_is_archived_idx" ON "notifications"("is_archived");

CREATE TABLE "audit_retention_policies" (
  "id" TEXT NOT NULL,
  "category" "retention_category" NOT NULL,
  "retention_days" INTEGER NOT NULL,
  "archive_after_days" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "audit_retention_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audit_retention_policies_category_key" ON "audit_retention_policies"("category");

CREATE TABLE "retention_job_runs" (
  "id" TEXT NOT NULL,
  "job_name" TEXT NOT NULL,
  "status" "retention_job_status" NOT NULL DEFAULT 'RUNNING',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "records_processed" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  CONSTRAINT "retention_job_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "retention_job_runs_job_name_started_at_idx" ON "retention_job_runs"("job_name", "started_at");
CREATE INDEX "retention_job_runs_status_idx" ON "retention_job_runs"("status");

CREATE TABLE "compliance_requests" (
  "id" TEXT NOT NULL,
  "request_type" "compliance_request_type" NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" "compliance_request_status" NOT NULL DEFAULT 'PENDING',
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_date_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "approved_by" TEXT,
  "approval_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "data_scope" TEXT,
  "target_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "metadata" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "compliance_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "compliance_requests_user_id_idx" ON "compliance_requests"("user_id");
CREATE INDEX "compliance_requests_status_idx" ON "compliance_requests"("status");
CREATE INDEX "compliance_requests_request_type_idx" ON "compliance_requests"("request_type");
CREATE INDEX "compliance_requests_due_date_at_idx" ON "compliance_requests"("due_date_at");
ALTER TABLE "compliance_requests" ADD CONSTRAINT "compliance_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "compliance_request_audits" (
  "id" TEXT NOT NULL,
  "compliance_request_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_type" "enterprise_actor_type" NOT NULL,
  "action" TEXT NOT NULL,
  "changes_before" JSONB,
  "changes_after" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_request_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "compliance_request_audits_compliance_request_id_idx" ON "compliance_request_audits"("compliance_request_id");
CREATE INDEX "compliance_request_audits_created_at_idx" ON "compliance_request_audits"("created_at");
ALTER TABLE "compliance_request_audits" ADD CONSTRAINT "compliance_request_audits_compliance_request_id_fkey"
  FOREIGN KEY ("compliance_request_id") REFERENCES "compliance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_request_audits" ADD CONSTRAINT "compliance_request_audits_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "data_export_requests" (
  "id" TEXT NOT NULL,
  "compliance_request_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "export_status" "export_status" NOT NULL DEFAULT 'PENDING',
  "file_url" TEXT,
  "file_storage_key" TEXT,
  "file_size" INTEGER,
  "file_hash" TEXT,
  "includes_profile" BOOLEAN NOT NULL DEFAULT true,
  "includes_bookings" BOOLEAN NOT NULL DEFAULT true,
  "includes_payments" BOOLEAN NOT NULL DEFAULT true,
  "includes_wallet" BOOLEAN NOT NULL DEFAULT true,
  "includes_audit" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exported_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "downloaded_at" TIMESTAMP(3),
  CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "data_export_requests_compliance_request_id_key" ON "data_export_requests"("compliance_request_id");
CREATE INDEX "data_export_requests_user_id_idx" ON "data_export_requests"("user_id");
CREATE INDEX "data_export_requests_export_status_idx" ON "data_export_requests"("export_status");
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_compliance_request_id_fkey"
  FOREIGN KEY ("compliance_request_id") REFERENCES "compliance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "deletion_requests" (
  "id" TEXT NOT NULL,
  "compliance_request_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "deletion_status" "compliance_deletion_status" NOT NULL DEFAULT 'PENDING',
  "delete_all" BOOLEAN NOT NULL DEFAULT true,
  "selective_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "grace_period_ends_at" TIMESTAMP(3) NOT NULL,
  "deletion_started_at" TIMESTAMP(3),
  "deletion_completed_at" TIMESTAMP(3),
  "permanently_deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "deletion_requests_compliance_request_id_key" ON "deletion_requests"("compliance_request_id");
CREATE INDEX "deletion_requests_user_id_idx" ON "deletion_requests"("user_id");
CREATE INDEX "deletion_requests_deletion_status_idx" ON "deletion_requests"("deletion_status");
CREATE INDEX "deletion_requests_grace_period_ends_at_idx" ON "deletion_requests"("grace_period_ends_at");
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_compliance_request_id_fkey"
  FOREIGN KEY ("compliance_request_id") REFERENCES "compliance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "audit_retention_policies" ("id", "category", "retention_days", "archive_after_days", "updated_at")
VALUES
  (gen_random_uuid()::text, 'SECURITY_EVENTS', 2555, 365, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PAYMENT_EVENTS', 2920, 730, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'FINANCIAL_LEDGER', 3650, 1095, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'LOGIN_EVENTS', 730, 180, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SYSTEM_LOGS', 365, 90, CURRENT_TIMESTAMP)
ON CONFLICT ("category") DO NOTHING;
