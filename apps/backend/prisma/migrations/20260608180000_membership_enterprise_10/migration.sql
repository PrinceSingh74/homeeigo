-- Enterprise membership 10/10: priority scores, match audit, cashback lifecycle

ALTER TYPE "CampaignType" ADD VALUE IF NOT EXISTS 'DISCOUNT';
ALTER TYPE "CampaignType" ADD VALUE IF NOT EXISTS 'CASHBACK';
ALTER TYPE "CampaignType" ADD VALUE IF NOT EXISTS 'FREE_SERVICE';
ALTER TYPE "CampaignType" ADD VALUE IF NOT EXISTS 'BONUS_HCOINS';
ALTER TYPE "CampaignType" ADD VALUE IF NOT EXISTS 'REFERRAL_BOOST';

ALTER TYPE "CashbackStatus" ADD VALUE IF NOT EXISTS 'REDEEMED';

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "priority_score" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "estimated_wait_time_ms" INTEGER;

ALTER TABLE "membership_cashbacks" ADD COLUMN IF NOT EXISTS "payment_id" TEXT;
CREATE INDEX IF NOT EXISTS "membership_cashbacks_payment_id_idx" ON "membership_cashbacks"("payment_id");

ALTER TABLE "membership_cashbacks" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE TABLE IF NOT EXISTS "provider_match_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "membership_tier" TEXT,
    "priority_score" INTEGER NOT NULL DEFAULT 10,
    "total_score" DOUBLE PRECISION NOT NULL,
    "premium_boost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rating_score" DOUBLE PRECISION NOT NULL,
    "distance_score" DOUBLE PRECISION NOT NULL,
    "response_score" DOUBLE PRECISION NOT NULL,
    "completion_score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_match_scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "provider_match_scores_user_id_idx" ON "provider_match_scores"("user_id");
CREATE INDEX IF NOT EXISTS "provider_match_scores_provider_id_idx" ON "provider_match_scores"("provider_id");
CREATE INDEX IF NOT EXISTS "provider_match_scores_service_id_idx" ON "provider_match_scores"("service_id");
CREATE INDEX IF NOT EXISTS "provider_match_scores_created_at_idx" ON "provider_match_scores"("created_at");

ALTER TABLE "provider_match_scores" ADD CONSTRAINT "provider_match_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_match_scores" ADD CONSTRAINT "provider_match_scores_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
