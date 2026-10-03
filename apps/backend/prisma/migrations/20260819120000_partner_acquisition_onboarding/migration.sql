-- Partner Acquisition & Onboarding (Section 01)

CREATE TYPE "PartnerLeadSource" AS ENUM (
  'APNA', 'JOBHAI', 'REFERRAL', 'RWA', 'CONTRACTOR',
  'LOCAL_SHOP', 'DIRECT', 'SOCIAL', 'CAMPAIGN', 'PARTNER_REFERRAL'
);

CREATE TYPE "PartnerLeadStatus" AS ENUM (
  'NEW', 'CONTACTED', 'INTERESTED', 'APPLICATION_STARTED', 'APPLICATION_SUBMITTED',
  'KYC_PENDING', 'VERIFICATION', 'TRAINING', 'APPROVED', 'ACTIVATED', 'DORMANT',
  'REJECTED', 'DUPLICATE', 'INVALID', 'WITHDRAWN'
);

CREATE TYPE "PartnerLeadActivityType" AS ENUM (
  'NOTE', 'CALL', 'MESSAGE', 'STATUS_CHANGE', 'ASSIGNMENT',
  'FOLLOW_UP', 'DUPLICATE_CHECK', 'APPLICATION_LINKED', 'SYSTEM'
);

CREATE TYPE "PartnerAssessmentStatus" AS ENUM (
  'NOT_STARTED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'RETRY_AVAILABLE'
);

ALTER TABLE "partner_registration_sessions"
  ADD COLUMN IF NOT EXISTS "lead_id" TEXT,
  ADD COLUMN IF NOT EXISTS "current_step" TEXT,
  ADD COLUMN IF NOT EXISTS "completed_steps" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "draft_data" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "last_saved_at" TIMESTAMP(3);

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "primary_skill" TEXT,
  ADD COLUMN IF NOT EXISTS "secondary_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "emergency_contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "emergency_contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "service_radius_km" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "base_latitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "base_longitude" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "partner_leads" (
  "id" TEXT NOT NULL,
  "source" "PartnerLeadSource" NOT NULL DEFAULT 'DIRECT',
  "source_campaign" TEXT,
  "channel" TEXT,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "phone_hash" TEXT NOT NULL,
  "email" TEXT,
  "email_hash" TEXT,
  "skill_interest" TEXT,
  "city" TEXT,
  "zone" TEXT,
  "status" "PartnerLeadStatus" NOT NULL DEFAULT 'NEW',
  "assigned_to_admin_id" TEXT,
  "consent_status" TEXT,
  "preferred_contact_method" TEXT,
  "notes" TEXT,
  "next_follow_up_at" TIMESTAMP(3),
  "follow_up_reason" TEXT,
  "lead_score" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "first_contact_at" TIMESTAMP(3),
  "application_at" TIMESTAMP(3),
  "activation_at" TIMESTAMP(3),
  "last_activity_at" TIMESTAMP(3),
  "user_id" TEXT,
  "provider_id" TEXT,
  "merged_into_lead_id" TEXT,
  "duplicate_of_lead_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "partner_lead_activities" (
  "id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "type" "PartnerLeadActivityType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "actor_id" TEXT,
  "actor_type" TEXT NOT NULL DEFAULT 'admin',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_lead_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "partner_lead_status_history" (
  "id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "from_status" "PartnerLeadStatus",
  "to_status" "PartnerLeadStatus" NOT NULL,
  "actor_id" TEXT,
  "actor_type" TEXT NOT NULL DEFAULT 'admin',
  "reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_lead_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "partner_assessments" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "skill_slug" TEXT NOT NULL,
  "status" "PartnerAssessmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "score" INTEGER,
  "max_score" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_leads_user_id_key" ON "partner_leads"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_leads_provider_id_key" ON "partner_leads"("provider_id");
CREATE INDEX IF NOT EXISTS "partner_leads_status_idx" ON "partner_leads"("status");
CREATE INDEX IF NOT EXISTS "partner_leads_source_idx" ON "partner_leads"("source");
CREATE INDEX IF NOT EXISTS "partner_leads_phone_hash_idx" ON "partner_leads"("phone_hash");
CREATE INDEX IF NOT EXISTS "partner_leads_email_hash_idx" ON "partner_leads"("email_hash");
CREATE INDEX IF NOT EXISTS "partner_leads_assigned_to_admin_id_idx" ON "partner_leads"("assigned_to_admin_id");
CREATE INDEX IF NOT EXISTS "partner_leads_next_follow_up_at_idx" ON "partner_leads"("next_follow_up_at");
CREATE INDEX IF NOT EXISTS "partner_leads_last_activity_at_idx" ON "partner_leads"("last_activity_at");
CREATE INDEX IF NOT EXISTS "partner_leads_created_at_idx" ON "partner_leads"("created_at");
CREATE INDEX IF NOT EXISTS "partner_leads_city_idx" ON "partner_leads"("city");
CREATE INDEX IF NOT EXISTS "partner_leads_zone_idx" ON "partner_leads"("zone");

CREATE INDEX IF NOT EXISTS "partner_lead_activities_lead_id_created_at_idx" ON "partner_lead_activities"("lead_id", "created_at");
CREATE INDEX IF NOT EXISTS "partner_lead_status_history_lead_id_created_at_idx" ON "partner_lead_status_history"("lead_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "partner_assessments_provider_id_skill_slug_key" ON "partner_assessments"("provider_id", "skill_slug");
CREATE INDEX IF NOT EXISTS "partner_assessments_provider_id_idx" ON "partner_assessments"("provider_id");
CREATE INDEX IF NOT EXISTS "partner_assessments_status_idx" ON "partner_assessments"("status");

CREATE INDEX IF NOT EXISTS "partner_registration_sessions_lead_id_idx" ON "partner_registration_sessions"("lead_id");

ALTER TABLE "partner_registration_sessions"
  ADD CONSTRAINT "partner_registration_sessions_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "partner_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partner_leads"
  ADD CONSTRAINT "partner_leads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partner_leads"
  ADD CONSTRAINT "partner_leads_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partner_lead_activities"
  ADD CONSTRAINT "partner_lead_activities_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "partner_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_lead_status_history"
  ADD CONSTRAINT "partner_lead_status_history_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "partner_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_assessments"
  ADD CONSTRAINT "partner_assessments_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
