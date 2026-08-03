-- Referral Fraud Intelligence Engine

CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'REVIEW', 'FROZEN', 'APPROVED', 'REJECTED');
CREATE TYPE "FraudEventType" AS ENUM ('SIGNUP', 'REFERRAL', 'BOOKING', 'COMMISSION', 'WITHDRAWAL');
CREATE TYPE "FraudRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "FraudAlertStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

ALTER TYPE "ReferralStatus" ADD VALUE IF NOT EXISTS 'FRAUD_BLOCKED';

ALTER TABLE "referral_transactions" ADD COLUMN IF NOT EXISTS "fraud_flagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "referral_transactions" ADD COLUMN IF NOT EXISTS "risk_score" INTEGER;

ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "risk_score" INTEGER;
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "frozen_at" TIMESTAMP(3);
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT;
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "released_at" TIMESTAMP(3);
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "reject_reason" TEXT;

CREATE TABLE "fraud_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "event_type" "FraudEventType" NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "device_id" TEXT,
    "device_fingerprint" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "browser_fingerprint" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "city" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "network_metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_signals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fraud_risk_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "level" "FraudRiskLevel" NOT NULL DEFAULT 'LOW',
    "factors" TEXT,
    "last_evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fraud_risk_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fraud_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "referral_transaction_id" TEXT,
    "commission_id" TEXT,
    "category" TEXT NOT NULL,
    "severity" "FraudRiskLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "FraudAlertStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fraud_decision_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_user_id" TEXT,
    "target_commission_id" TEXT,
    "target_referral_id" TEXT,
    "reason" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_decision_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fraud_risk_scores_user_id_key" ON "fraud_risk_scores"("user_id");
CREATE INDEX "fraud_signals_user_id_idx" ON "fraud_signals"("user_id");
CREATE INDEX "fraud_signals_device_id_idx" ON "fraud_signals"("device_id");
CREATE INDEX "fraud_signals_ip_address_idx" ON "fraud_signals"("ip_address");
CREATE INDEX "fraud_signals_device_fingerprint_idx" ON "fraud_signals"("device_fingerprint");
CREATE INDEX "fraud_signals_browser_fingerprint_idx" ON "fraud_signals"("browser_fingerprint");
CREATE INDEX "fraud_signals_event_type_idx" ON "fraud_signals"("event_type");
CREATE INDEX "fraud_signals_created_at_idx" ON "fraud_signals"("created_at");
CREATE INDEX "fraud_risk_scores_level_idx" ON "fraud_risk_scores"("level");
CREATE INDEX "fraud_risk_scores_score_idx" ON "fraud_risk_scores"("score");
CREATE INDEX "fraud_alerts_status_idx" ON "fraud_alerts"("status");
CREATE INDEX "fraud_alerts_severity_idx" ON "fraud_alerts"("severity");
CREATE INDEX "fraud_alerts_user_id_idx" ON "fraud_alerts"("user_id");
CREATE INDEX "fraud_alerts_category_idx" ON "fraud_alerts"("category");
CREATE INDEX "fraud_alerts_created_at_idx" ON "fraud_alerts"("created_at");
CREATE INDEX "fraud_decision_logs_target_user_id_idx" ON "fraud_decision_logs"("target_user_id");
CREATE INDEX "fraud_decision_logs_target_commission_id_idx" ON "fraud_decision_logs"("target_commission_id");
CREATE INDEX "fraud_decision_logs_action_idx" ON "fraud_decision_logs"("action");
CREATE INDEX "fraud_decision_logs_created_at_idx" ON "fraud_decision_logs"("created_at");
CREATE INDEX "referral_transactions_fraud_flagged_idx" ON "referral_transactions"("fraud_flagged");
CREATE INDEX "referral_commissions_status_idx" ON "referral_commissions"("status");

ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fraud_risk_scores" ADD CONSTRAINT "fraud_risk_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_referral_transaction_id_fkey" FOREIGN KEY ("referral_transaction_id") REFERENCES "referral_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "referral_commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
