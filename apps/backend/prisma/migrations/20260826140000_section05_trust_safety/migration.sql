-- Section 05: partner compliance expiry, risk intelligence, safety incidents.
-- Existing KYC / documents / tracking / fraud tables are unchanged.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComplianceReminderWindow') THEN
    CREATE TYPE "ComplianceReminderWindow" AS ENUM ('D30', 'D7', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerRiskLevel') THEN
    CREATE TYPE "PartnerRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerRiskReviewStatus') THEN
    CREATE TYPE "PartnerRiskReviewStatus" AS ENUM ('MONITOR', 'REVIEW', 'RESTRICT', 'SUSPEND', 'CLEARED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerRiskSignalType') THEN
    CREATE TYPE "PartnerRiskSignalType" AS ENUM (
      'GPS_SPOOF', 'IMPOSSIBLE_TRAVEL', 'FAKE_ARRIVAL', 'FAKE_COMPLETION',
      'MULTIPLE_ACCOUNTS', 'DEVICE_ANOMALY', 'CANCELLATION_ABUSE', 'EARNINGS_ABUSE', 'REFERRAL_ABUSE'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerSafetyIncidentType') THEN
    CREATE TYPE "PartnerSafetyIncidentType" AS ENUM (
      'SOS', 'ACCIDENT', 'THREAT', 'MEDICAL', 'CUSTOMER_SAFETY', 'PARTNER_SAFETY', 'LOCATION_DANGER', 'OTHER'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerSafetyIncidentStatus') THEN
    CREATE TYPE "PartnerSafetyIncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
  END IF;
END $$;

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "compliance_restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "compliance_restricted_at" TIMESTAMP(3);
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "compliance_restriction_reason" TEXT;
CREATE INDEX IF NOT EXISTS "providers_compliance_restricted_idx" ON "providers"("compliance_restricted");

ALTER TABLE "provider_documents" ADD COLUMN IF NOT EXISTS "issue_date" TIMESTAMP(3);
ALTER TABLE "provider_documents" ADD COLUMN IF NOT EXISTS "issuer" TEXT;
CREATE INDEX IF NOT EXISTS "provider_documents_expiry_date_idx" ON "provider_documents"("expiry_date");

ALTER TABLE "partner_background_checks" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "partner_compliance_reminders" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "window" "ComplianceReminderWindow" NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notification_id" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_compliance_reminders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_compliance_reminders_document_id_window_key"
  ON "partner_compliance_reminders"("document_id", "window");
CREATE INDEX IF NOT EXISTS "partner_compliance_reminders_provider_id_sent_at_idx"
  ON "partner_compliance_reminders"("provider_id", "sent_at");

CREATE TABLE IF NOT EXISTS "partner_compliance_restrictions" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "document_id" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "restricted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unrestricted_at" TIMESTAMP(3),
    "unrestricted_by" TEXT,
    "actor_id" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_compliance_restrictions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "partner_compliance_restrictions_provider_id_active_idx"
  ON "partner_compliance_restrictions"("provider_id", "active");
CREATE INDEX IF NOT EXISTS "partner_compliance_restrictions_active_restricted_at_idx"
  ON "partner_compliance_restrictions"("active", "restricted_at");

CREATE TABLE IF NOT EXISTS "partner_risk_profiles" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "risk_level" "PartnerRiskLevel" NOT NULL DEFAULT 'LOW',
    "review_status" "PartnerRiskReviewStatus" NOT NULL DEFAULT 'MONITOR',
    "explanation" JSONB,
    "last_evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_risk_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_risk_profiles_provider_id_key" ON "partner_risk_profiles"("provider_id");
CREATE INDEX IF NOT EXISTS "partner_risk_profiles_risk_level_review_status_idx"
  ON "partner_risk_profiles"("risk_level", "review_status");
CREATE INDEX IF NOT EXISTS "partner_risk_profiles_review_status_last_evaluated_at_idx"
  ON "partner_risk_profiles"("review_status", "last_evaluated_at");

CREATE TABLE IF NOT EXISTS "partner_risk_signals" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "type" "PartnerRiskSignalType" NOT NULL,
    "source" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB NOT NULL,
    "booking_id" TEXT,
    "fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_risk_signals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_risk_signals_fingerprint_key" ON "partner_risk_signals"("fingerprint");
CREATE INDEX IF NOT EXISTS "partner_risk_signals_provider_id_created_at_idx"
  ON "partner_risk_signals"("provider_id", "created_at");
CREATE INDEX IF NOT EXISTS "partner_risk_signals_type_created_at_idx"
  ON "partner_risk_signals"("type", "created_at");
CREATE INDEX IF NOT EXISTS "partner_risk_signals_booking_id_idx" ON "partner_risk_signals"("booking_id");

CREATE TABLE IF NOT EXISTS "partner_safety_incidents" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "type" "PartnerSafetyIncidentType" NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "PartnerSafetyIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "evidence" JSONB,
    "assigned_to" TEXT,
    "assigned_by" TEXT,
    "assigned_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_notes" TEXT,
    "open_idempotency_key" TEXT,
    "emergency_contact_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_safety_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_safety_incidents_open_idempotency_key_key"
  ON "partner_safety_incidents"("open_idempotency_key");
CREATE INDEX IF NOT EXISTS "partner_safety_incidents_provider_id_status_idx"
  ON "partner_safety_incidents"("provider_id", "status");
CREATE INDEX IF NOT EXISTS "partner_safety_incidents_status_created_at_idx"
  ON "partner_safety_incidents"("status", "created_at");
CREATE INDEX IF NOT EXISTS "partner_safety_incidents_type_status_idx"
  ON "partner_safety_incidents"("type", "status");
CREATE INDEX IF NOT EXISTS "partner_safety_incidents_booking_id_idx"
  ON "partner_safety_incidents"("booking_id");

DO $$ BEGIN
  ALTER TABLE "partner_compliance_reminders"
    ADD CONSTRAINT "partner_compliance_reminders_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_compliance_reminders"
    ADD CONSTRAINT "partner_compliance_reminders_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "provider_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_compliance_restrictions"
    ADD CONSTRAINT "partner_compliance_restrictions_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_compliance_restrictions"
    ADD CONSTRAINT "partner_compliance_restrictions_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "provider_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_risk_profiles"
    ADD CONSTRAINT "partner_risk_profiles_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_risk_signals"
    ADD CONSTRAINT "partner_risk_signals_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_safety_incidents"
    ADD CONSTRAINT "partner_safety_incidents_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
