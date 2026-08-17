-- Phase 6E' — Notification Platform foundation.
--
-- Purely additive: four enums and three tables. Nothing existing is altered — `notifications`,
-- `email_logs`, `user_devices` and every current caller of notificationService keep working
-- unchanged. The router sits above them rather than replacing them.

CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS');
CREATE TYPE "NotificationCategory" AS ENUM ('TRANSACTIONAL', 'SECURITY', 'OPTIONAL');
CREATE TYPE "NotificationTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'UNAVAILABLE', 'SKIPPED');

CREATE TABLE "notification_templates" (
  "id"                TEXT NOT NULL,
  "template_id"       TEXT NOT NULL,
  "version"           INTEGER NOT NULL,
  "notification_type" TEXT NOT NULL,
  "category"          "NotificationCategory" NOT NULL,
  "channel"           "NotificationChannel" NOT NULL,
  "language"          TEXT NOT NULL DEFAULT 'en',
  "status"            "NotificationTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "title"             TEXT,
  "body"              TEXT NOT NULL,
  "variables_schema"  JSONB NOT NULL,
  "activated_at"      TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_templates_template_id_version_key"
  ON "notification_templates"("template_id", "version");
CREATE INDEX "notification_templates_lookup_idx"
  ON "notification_templates"("notification_type", "channel", "language", "status");

CREATE TABLE "notification_preferences" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "channel"    "NotificationChannel" NOT NULL,
  "category"   "NotificationCategory" NOT NULL,
  "enabled"    BOOLEAN NOT NULL DEFAULT true,
  "language"   TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_category_key"
  ON "notification_preferences"("user_id", "channel", "category");
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

CREATE TABLE "notification_deliveries" (
  "id"                TEXT NOT NULL,
  "notification_id"   TEXT NOT NULL,
  "recipient_type"    TEXT NOT NULL,
  "recipient_id"      TEXT NOT NULL,
  "notification_type" TEXT NOT NULL,
  "category"          "NotificationCategory" NOT NULL,
  "channel"           "NotificationChannel" NOT NULL,
  "template_id"       TEXT,
  "template_version"  INTEGER,
  "language"          TEXT,
  "status"            "NotificationDeliveryStatus" NOT NULL,
  "reason_code"       TEXT,
  "provider_ref"      TEXT,
  "idempotency_key"   TEXT NOT NULL,
  "trace_id"          TEXT,
  "correlation_id"    TEXT,
  "sent_at"           TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_deliveries_notification_id_key"
  ON "notification_deliveries"("notification_id");
-- The duplicate-send guard: one operation identity, one delivery row.
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key"
  ON "notification_deliveries"("idempotency_key");
CREATE INDEX "notification_deliveries_recipient_idx"
  ON "notification_deliveries"("recipient_type", "recipient_id", "created_at");
CREATE INDEX "notification_deliveries_status_created_at_idx"
  ON "notification_deliveries"("status", "created_at");
CREATE INDEX "notification_deliveries_type_created_at_idx"
  ON "notification_deliveries"("notification_type", "created_at");
