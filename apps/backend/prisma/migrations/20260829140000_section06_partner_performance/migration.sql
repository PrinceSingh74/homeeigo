-- Section 06: unified partner score, career ladder, provider lifecycle history.
-- Does not replace Provider rate counters, Rating, PartnerLeadStatus, or availability FSM.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerScoreBand') THEN
    CREATE TYPE "PartnerScoreBand" AS ENUM (
      'EXCELLENT', 'GOOD', 'HEALTHY', 'NEEDS_ATTENTION', 'AT_RISK', 'INSUFFICIENT_DATA'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerCareerLevel') THEN
    CREATE TYPE "PartnerCareerLevel" AS ENUM ('STARTER', 'PROFESSIONAL', 'EXPERT', 'ELITE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerLifecycleState') THEN
    CREATE TYPE "PartnerLifecycleState" AS ENUM (
      'APPLIED', 'KYC_PENDING', 'VERIFICATION', 'TRAINING', 'APPROVED',
      'ACTIVE', 'PAUSED', 'UNDER_REVIEW', 'SUSPENDED', 'REACTIVATED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerLifecycleActor') THEN
    CREATE TYPE "PartnerLifecycleActor" AS ENUM (
      'SYSTEM', 'PARTNER', 'ADMIN', 'COMPLIANCE', 'TRUST', 'OPERATIONS'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerLifecycleReason') THEN
    CREATE TYPE "PartnerLifecycleReason" AS ENUM (
      'KYC_APPROVED', 'TRAINING_COMPLETED', 'MANUAL_APPROVAL', 'COMPLIANCE_EXPIRY',
      'SAFETY_REVIEW', 'PARTNER_REQUEST', 'ADMIN_ACTION', 'POLICY_TRIGGER',
      'RISK_POLICY', 'REACTIVATION'
    );
  END IF;
END $$;

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "lifecycle_state" "PartnerLifecycleState" NOT NULL DEFAULT 'APPLIED';
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "career_level" "PartnerCareerLevel" NOT NULL DEFAULT 'STARTER';

UPDATE "providers" SET "lifecycle_state" = CASE
  WHEN "is_banned" = true OR ("is_active" = false AND "is_approved" = true) THEN 'SUSPENDED'::"PartnerLifecycleState"
  WHEN "is_approved" = true AND "is_active" = true THEN 'ACTIVE'::"PartnerLifecycleState"
  WHEN "registration_status" = 'APPROVED' THEN 'APPROVED'::"PartnerLifecycleState"
  WHEN "registration_status" = 'PENDING' THEN 'APPLIED'::"PartnerLifecycleState"
  ELSE "lifecycle_state"
END
WHERE "lifecycle_state" = 'APPLIED';

CREATE INDEX IF NOT EXISTS "providers_lifecycle_state_idx" ON "providers"("lifecycle_state");
CREATE INDEX IF NOT EXISTS "providers_career_level_idx" ON "providers"("career_level");

CREATE TABLE IF NOT EXISTS "partner_scores" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "overall_score" DOUBLE PRECISION,
    "band" "PartnerScoreBand" NOT NULL,
    "quality" DOUBLE PRECISION,
    "reliability" DOUBLE PRECISION,
    "completion" DOUBLE PRECISION,
    "on_time" DOUBLE PRECISION,
    "customer_satisfaction" DOUBLE PRECISION,
    "compliance" DOUBLE PRECISION,
    "safety" DOUBLE PRECISION,
    "quality_weight" DOUBLE PRECISION NOT NULL,
    "reliability_weight" DOUBLE PRECISION NOT NULL,
    "completion_weight" DOUBLE PRECISION NOT NULL,
    "on_time_weight" DOUBLE PRECISION NOT NULL,
    "csat_weight" DOUBLE PRECISION NOT NULL,
    "compliance_weight" DOUBLE PRECISION NOT NULL,
    "safety_weight" DOUBLE PRECISION NOT NULL,
    "sample_completed_jobs" INTEGER NOT NULL,
    "sample_ratings" INTEGER NOT NULL,
    "sample_arrivals" INTEGER NOT NULL,
    "sample_assignments" INTEGER NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_scores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_scores_provider_id_key" ON "partner_scores"("provider_id");
CREATE INDEX IF NOT EXISTS "partner_scores_band_idx" ON "partner_scores"("band");
CREATE INDEX IF NOT EXISTS "partner_scores_calculated_at_idx" ON "partner_scores"("calculated_at");

CREATE TABLE IF NOT EXISTS "partner_score_history" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "snapshot_key" TEXT NOT NULL,
    "previous_score" DOUBLE PRECISION,
    "new_score" DOUBLE PRECISION,
    "previous_band" "PartnerScoreBand",
    "new_band" "PartnerScoreBand" NOT NULL,
    "delta" DOUBLE PRECISION,
    "reasons" JSONB NOT NULL,
    "components" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_score_history_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_score_history_provider_id_snapshot_key_key"
  ON "partner_score_history"("provider_id", "snapshot_key");
CREATE INDEX IF NOT EXISTS "partner_score_history_provider_id_created_at_idx"
  ON "partner_score_history"("provider_id", "created_at");

CREATE TABLE IF NOT EXISTS "partner_career_history" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "previous_level" "PartnerCareerLevel",
    "new_level" "PartnerCareerLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "qualifying_metrics" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_career_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "partner_career_history_provider_id_created_at_idx"
  ON "partner_career_history"("provider_id", "created_at");

CREATE TABLE IF NOT EXISTS "partner_status_history" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "previous_state" "PartnerLifecycleState",
    "new_state" "PartnerLifecycleState" NOT NULL,
    "actor_type" "PartnerLifecycleActor" NOT NULL,
    "actor_id" TEXT,
    "reason_code" "PartnerLifecycleReason" NOT NULL,
    "reason_text" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "partner_status_history_provider_id_created_at_idx"
  ON "partner_status_history"("provider_id", "created_at");
CREATE INDEX IF NOT EXISTS "partner_status_history_new_state_idx"
  ON "partner_status_history"("new_state");

CREATE TABLE IF NOT EXISTS "partner_badge_awards" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "badge_code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "qualifying_metrics" JSONB,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "partner_badge_awards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "partner_badge_awards_provider_id_badge_code_key"
  ON "partner_badge_awards"("provider_id", "badge_code");
CREATE INDEX IF NOT EXISTS "partner_badge_awards_provider_id_awarded_at_idx"
  ON "partner_badge_awards"("provider_id", "awarded_at");

DO $$ BEGIN
  ALTER TABLE "partner_scores" ADD CONSTRAINT "partner_scores_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_score_history" ADD CONSTRAINT "partner_score_history_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_career_history" ADD CONSTRAINT "partner_career_history_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_status_history" ADD CONSTRAINT "partner_status_history_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "partner_badge_awards" ADD CONSTRAINT "partner_badge_awards_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
