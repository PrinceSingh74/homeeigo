-- Membership Premium Engine (Phases A–F)

CREATE TYPE "QueuePriority" AS ENUM ('HIGH', 'NORMAL');
CREATE TYPE "SupportPriorityLevel" AS ENUM ('HIGH', 'NORMAL', 'LOW');
CREATE TYPE "CampaignType" AS ENUM ('COUPON', 'PROMOTION', 'BUNDLE', 'OFFER');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'EXPIRED');
CREATE TYPE "CashbackStatus" AS ENUM ('PENDING', 'CREDITED', 'REVERSED');

ALTER TABLE "bookings" ADD COLUMN "campaign_id" TEXT;
ALTER TABLE "bookings" ADD COLUMN "campaign_discount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN "queue_priority" "QueuePriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "bookings" ADD COLUMN "queue_position" INTEGER;
ALTER TABLE "bookings" ADD COLUMN "queued_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN "assigned_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN "wait_time_ms" INTEGER;
ALTER TABLE "bookings" ADD COLUMN "priority_served" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bookings" ADD COLUMN "premium_matched" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "support_tickets" ADD COLUMN "priority_level" "SupportPriorityLevel" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "support_tickets" ADD COLUMN "sla_due_at" TIMESTAMP(3);
ALTER TABLE "support_tickets" ADD COLUMN "first_response_at" TIMESTAMP(3);
ALTER TABLE "support_tickets" ADD COLUMN "response_time_ms" INTEGER;

CREATE TABLE "membership_cashbacks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "cashback_pct" DOUBLE PRECISION NOT NULL,
    "settled_amount" DOUBLE PRECISION NOT NULL,
    "wallet_transaction_id" TEXT,
    "status" "CashbackStatus" NOT NULL DEFAULT 'CREDITED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_cashbacks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CampaignType" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "premium_only" BOOLEAN NOT NULL DEFAULT true,
    "discount_pct" DOUBLE PRECISION,
    "discount_amount" DOUBLE PRECISION,
    "min_order_amount" DOUBLE PRECISION,
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coupon_usages" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "discount_applied" DOUBLE PRECISION NOT NULL,
    "revenue_before" DOUBLE PRECISION NOT NULL,
    "revenue_after" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_cashbacks_booking_id_key" ON "membership_cashbacks"("booking_id");
CREATE INDEX "membership_cashbacks_user_id_idx" ON "membership_cashbacks"("user_id");
CREATE INDEX "membership_cashbacks_status_idx" ON "membership_cashbacks"("status");
CREATE INDEX "membership_cashbacks_created_at_idx" ON "membership_cashbacks"("created_at");

CREATE UNIQUE INDEX "campaigns_code_key" ON "campaigns"("code");
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX "campaigns_type_idx" ON "campaigns"("type");
CREATE INDEX "campaigns_premium_only_idx" ON "campaigns"("premium_only");

CREATE INDEX "coupon_usages_campaign_id_idx" ON "coupon_usages"("campaign_id");
CREATE INDEX "coupon_usages_user_id_idx" ON "coupon_usages"("user_id");
CREATE INDEX "coupon_usages_created_at_idx" ON "coupon_usages"("created_at");

CREATE INDEX "bookings_queue_priority_status_idx" ON "bookings"("queue_priority", "status");
CREATE INDEX "bookings_campaign_id_idx" ON "bookings"("campaign_id");
CREATE INDEX "support_tickets_priority_level_idx" ON "support_tickets"("priority_level");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "membership_cashbacks" ADD CONSTRAINT "membership_cashbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_cashbacks" ADD CONSTRAINT "membership_cashbacks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
