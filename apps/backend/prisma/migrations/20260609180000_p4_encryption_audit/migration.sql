-- P4 Part A: Email/phone encryption fields, encryption key management, enterprise audit logs

CREATE TYPE "encryption_key_status" AS ENUM ('ACTIVE', 'ROTATED', 'RETIRED');
CREATE TYPE "key_purpose" AS ENUM ('EMAIL', 'PHONE', 'PAYMENT', 'PII', 'SENSITIVE_DOCUMENTS');
CREATE TYPE "data_encryption_status" AS ENUM ('ENCRYPTED', 'PARTIAL', 'DECRYPTED');
CREATE TYPE "enterprise_actor_type" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'API_KEY');
CREATE TYPE "enterprise_audit_status" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED', 'PARTIAL');
CREATE TYPE "retention_category" AS ENUM (
  'SECURITY_EVENTS',
  'PAYMENT_EVENTS',
  'FINANCIAL_LEDGER',
  'LOGIN_EVENTS',
  'SYSTEM_LOGS'
);

CREATE TABLE "encryption_keys" (
  "id" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "key_version" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
  "encrypted_key" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "key_wrap_auth_tag" TEXT NOT NULL,
  "status" "encryption_key_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotated_at" TIMESTAMP(3),
  "retired_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "purpose" "key_purpose" NOT NULL,
  "created_by" TEXT NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "encryption_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "encryption_keys_key_id_key" ON "encryption_keys"("key_id");
CREATE UNIQUE INDEX "encryption_keys_purpose_key_version_key" ON "encryption_keys"("purpose", "key_version");
CREATE INDEX "encryption_keys_key_version_idx" ON "encryption_keys"("key_version");
CREATE INDEX "encryption_keys_status_idx" ON "encryption_keys"("status");
CREATE INDEX "encryption_keys_purpose_idx" ON "encryption_keys"("purpose");

CREATE TABLE "enterprise_audit_logs" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "resource_id" TEXT,
  "actor" TEXT,
  "actor_type" "enterprise_actor_type" NOT NULL,
  "changes_before" JSONB,
  "changes_after" JSONB,
  "changes_summary" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "device_id" TEXT,
  "trace_id" TEXT NOT NULL,
  "status" "enterprise_audit_status" NOT NULL DEFAULT 'SUCCESS',
  "error_message" TEXT,
  "retention_category" "retention_category" NOT NULL,
  "retention_expires_at" TIMESTAMP(3),
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMP(3),
  "hash" TEXT,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "enterprise_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enterprise_audit_logs_trace_id_key" ON "enterprise_audit_logs"("trace_id");
CREATE INDEX "enterprise_audit_logs_actor_idx" ON "enterprise_audit_logs"("actor");
CREATE INDEX "enterprise_audit_logs_action_idx" ON "enterprise_audit_logs"("action");
CREATE INDEX "enterprise_audit_logs_resource_idx" ON "enterprise_audit_logs"("resource");
CREATE INDEX "enterprise_audit_logs_resource_id_idx" ON "enterprise_audit_logs"("resource_id");
CREATE INDEX "enterprise_audit_logs_created_at_idx" ON "enterprise_audit_logs"("created_at");
CREATE INDEX "enterprise_audit_logs_retention_expires_at_idx" ON "enterprise_audit_logs"("retention_expires_at");
CREATE INDEX "enterprise_audit_logs_is_archived_idx" ON "enterprise_audit_logs"("is_archived");

CREATE TABLE "enterprise_audit_log_archives" (
  "id" TEXT NOT NULL,
  "original_log_id" TEXT NOT NULL,
  "compressed_data" TEXT NOT NULL,
  "storage_location" TEXT,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_by" TEXT NOT NULL,
  "archive_hash" TEXT NOT NULL,
  "delete_scheduled_at" TIMESTAMP(3),
  CONSTRAINT "enterprise_audit_log_archives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enterprise_audit_log_archives_original_log_id_key" ON "enterprise_audit_log_archives"("original_log_id");
CREATE INDEX "enterprise_audit_log_archives_archived_at_idx" ON "enterprise_audit_log_archives"("archived_at");

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_number_key";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_encrypted" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_encryption_key_version" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_encrypted" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_encryption_key_version" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "data_encryption_status" "data_encryption_status" NOT NULL DEFAULT 'PARTIAL';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "data_encrypted_at" TIMESTAMP(3);

ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "phone_number" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_hash_key" ON "users"("email_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_hash_key" ON "users"("phone_hash");
CREATE INDEX IF NOT EXISTS "users_email_hash_idx" ON "users"("email_hash");
CREATE INDEX IF NOT EXISTS "users_phone_hash_idx" ON "users"("phone_hash");

ALTER TABLE "otps" ADD COLUMN IF NOT EXISTS "phone_hash" TEXT;
ALTER TABLE "otps" ALTER COLUMN "phone_number" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "otps_phone_hash_created_at_idx" ON "otps"("phone_hash", "created_at");
