-- CreateEnum
CREATE TYPE "OpsAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL', 'ESCALATION');

-- CreateEnum
CREATE TYPE "AppLogCategory" AS ENUM ('APPLICATION', 'WEBHOOK', 'PAYMENT', 'AUDIT', 'SECURITY', 'FRAUD', 'FINANCE', 'BOOKING', 'PROVIDER');

-- CreateTable
CREATE TABLE "ops_alerts" (
    "id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" "OpsAlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ops_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_log_entries" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "category" "AppLogCategory" NOT NULL DEFAULT 'APPLICATION',
    "message" TEXT NOT NULL,
    "request_id" TEXT,
    "trace_id" TEXT,
    "user_id" TEXT,
    "booking_id" TEXT,
    "payment_id" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ops_alerts_alert_type_idx" ON "ops_alerts"("alert_type");

-- CreateIndex
CREATE INDEX "ops_alerts_severity_idx" ON "ops_alerts"("severity");

-- CreateIndex
CREATE INDEX "ops_alerts_resolved_idx" ON "ops_alerts"("resolved");

-- CreateIndex
CREATE INDEX "ops_alerts_created_at_idx" ON "ops_alerts"("created_at");

-- CreateIndex
CREATE INDEX "app_log_entries_request_id_idx" ON "app_log_entries"("request_id");

-- CreateIndex
CREATE INDEX "app_log_entries_trace_id_idx" ON "app_log_entries"("trace_id");

-- CreateIndex
CREATE INDEX "app_log_entries_user_id_idx" ON "app_log_entries"("user_id");

-- CreateIndex
CREATE INDEX "app_log_entries_booking_id_idx" ON "app_log_entries"("booking_id");

-- CreateIndex
CREATE INDEX "app_log_entries_payment_id_idx" ON "app_log_entries"("payment_id");

-- CreateIndex
CREATE INDEX "app_log_entries_category_idx" ON "app_log_entries"("category");

-- CreateIndex
CREATE INDEX "app_log_entries_level_idx" ON "app_log_entries"("level");

-- CreateIndex
CREATE INDEX "app_log_entries_created_at_idx" ON "app_log_entries"("created_at");
