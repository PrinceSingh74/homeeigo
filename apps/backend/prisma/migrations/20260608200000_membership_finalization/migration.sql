-- Membership finalization: assignment engine + membership coupon platform + performance indexes

CREATE TYPE "AssignmentJobStatus" AS ENUM ('PENDING', 'DISPATCHED', 'ACCEPTED', 'REJECTED', 'TIMEOUT', 'REASSIGNED', 'EXHAUSTED', 'CANCELLED');
CREATE TYPE "AssignmentAttemptStatus" AS ENUM ('SENT', 'ACCEPTED', 'REJECTED', 'TIMEOUT', 'SUPERSEDED');
CREATE TYPE "MembershipCouponStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

CREATE TABLE IF NOT EXISTS "assignment_jobs" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "status" "AssignmentJobStatus" NOT NULL DEFAULT 'PENDING',
    "current_provider_id" TEXT,
    "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
    "auto_reassign_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_dispatched_at" TIMESTAMP(3),
    "timeout_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assignment_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "assignment_attempts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "status" "AssignmentAttemptStatus" NOT NULL DEFAULT 'SENT',
    "dispatched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "response_ms" INTEGER,
    CONSTRAINT "assignment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "assignment_audits" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assignment_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coupon_segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan_tiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geographies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "service_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "coupon_segments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coupon_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MembershipCouponStatus" NOT NULL DEFAULT 'DRAFT',
    "segment_id" TEXT,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "coupon_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "membership_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MembershipCouponStatus" NOT NULL DEFAULT 'DRAFT',
    "campaign_id" TEXT,
    "discount_pct" DOUBLE PRECISION,
    "discount_amount" DOUBLE PRECISION,
    "min_order_amount" DOUBLE PRECISION,
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "plan_restricted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geography" TEXT,
    "service_category" TEXT,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_coupons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coupon_rules" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "plan_restricted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usage_limit" INTEGER,
    "user_limit" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "geography" TEXT,
    "service_category" TEXT,
    "min_order_amount" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "coupon_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "membership_coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "discount_applied" DOUBLE PRECISION NOT NULL,
    "revenue_before" DOUBLE PRECISION NOT NULL,
    "revenue_after" DOUBLE PRECISION NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "assignment_jobs_booking_id_key" ON "assignment_jobs"("booking_id");
CREATE INDEX IF NOT EXISTS "assignment_jobs_status_idx" ON "assignment_jobs"("status");
CREATE INDEX IF NOT EXISTS "assignment_jobs_status_last_dispatched_at_idx" ON "assignment_jobs"("status", "last_dispatched_at");
CREATE INDEX IF NOT EXISTS "assignment_jobs_created_at_idx" ON "assignment_jobs"("created_at");

CREATE INDEX IF NOT EXISTS "assignment_attempts_job_id_idx" ON "assignment_attempts"("job_id");
CREATE INDEX IF NOT EXISTS "assignment_attempts_provider_id_idx" ON "assignment_attempts"("provider_id");
CREATE INDEX IF NOT EXISTS "assignment_attempts_status_idx" ON "assignment_attempts"("status");
CREATE INDEX IF NOT EXISTS "assignment_attempts_dispatched_at_idx" ON "assignment_attempts"("dispatched_at");

CREATE INDEX IF NOT EXISTS "assignment_audits_job_id_idx" ON "assignment_audits"("job_id");
CREATE INDEX IF NOT EXISTS "assignment_audits_action_idx" ON "assignment_audits"("action");
CREATE INDEX IF NOT EXISTS "assignment_audits_created_at_idx" ON "assignment_audits"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "membership_coupons_code_key" ON "membership_coupons"("code");
CREATE INDEX IF NOT EXISTS "membership_coupons_status_idx" ON "membership_coupons"("status");
CREATE INDEX IF NOT EXISTS "membership_coupons_campaign_id_idx" ON "membership_coupons"("campaign_id");
CREATE INDEX IF NOT EXISTS "membership_coupons_code_status_idx" ON "membership_coupons"("code", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "coupon_rules_coupon_id_key" ON "coupon_rules"("coupon_id");

CREATE INDEX IF NOT EXISTS "membership_coupon_redemptions_coupon_id_idx" ON "membership_coupon_redemptions"("coupon_id");
CREATE INDEX IF NOT EXISTS "membership_coupon_redemptions_user_id_idx" ON "membership_coupon_redemptions"("user_id");
CREATE INDEX IF NOT EXISTS "membership_coupon_redemptions_booking_id_idx" ON "membership_coupon_redemptions"("booking_id");
CREATE INDEX IF NOT EXISTS "membership_coupon_redemptions_created_at_idx" ON "membership_coupon_redemptions"("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "membership_coupon_redemptions_idempotency_key_key" ON "membership_coupon_redemptions"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "membership_coupon_redemptions_coupon_id_user_id_booking_id_key" ON "membership_coupon_redemptions"("coupon_id", "user_id", "booking_id");

CREATE INDEX IF NOT EXISTS "coupon_campaigns_status_idx" ON "coupon_campaigns"("status");
CREATE INDEX IF NOT EXISTS "coupon_campaigns_segment_id_idx" ON "coupon_campaigns"("segment_id");

CREATE INDEX IF NOT EXISTS "bookings_status_provider_id_priority_score_queued_at_idx" ON "bookings"("status", "provider_id", "priority_score", "queued_at");

ALTER TABLE "assignment_jobs" ADD CONSTRAINT "assignment_jobs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_attempts" ADD CONSTRAINT "assignment_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "assignment_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_attempts" ADD CONSTRAINT "assignment_attempts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_audits" ADD CONSTRAINT "assignment_audits_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "assignment_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "coupon_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "membership_coupons" ADD CONSTRAINT "membership_coupons_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "coupon_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coupon_rules" ADD CONSTRAINT "coupon_rules_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "membership_coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_coupon_redemptions" ADD CONSTRAINT "membership_coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "membership_coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_coupon_redemptions" ADD CONSTRAINT "membership_coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_coupon_redemptions" ADD CONSTRAINT "membership_coupon_redemptions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
