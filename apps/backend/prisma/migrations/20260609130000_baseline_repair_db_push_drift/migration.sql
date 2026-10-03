-- Pass 13 Phase 14: baseline repair for prisma db push drift.
--
-- These tables and enums exist in prisma/schema.prisma but were never created by any
-- migration, so `prisma migrate deploy` against a fresh database failed at
-- 20260609160000_p3_gift_card_campaign_security (relation "gift_cards" does not exist).
--
-- Every statement is idempotent, so this migration is a no-op on databases that were
-- provisioned with db push and already carry these objects.
--
-- gift_cards intentionally omits last_attempt_at / failed_attempts: they are added by
-- 20260609160000_p3_gift_card_campaign_security with an unguarded ADD COLUMN.

-- ---------------------------------------------------------------- enums
DO $$ BEGIN
  CREATE TYPE "SubscriptionInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GiftCardStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --------------------------------------------------------------- tables
CREATE TABLE IF NOT EXISTS "ai_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "topics" JSONB,
    "pinned_facts" JSONB,
    "entities" JSONB,
    "intent_history" JSONB,
    "sentiment" TEXT,
    "resolution" TEXT,
    "compressed_at" TIMESTAMP(3),
    "token_budget" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER,
    "intent" TEXT,
    "entities" JSONB,
    "sentiment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "membership_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'premium',
    "interval" "SubscriptionInterval" NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "subscription_benefits" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "quota_limit" INTEGER,
    "quota_period" TEXT,
    "type" TEXT,
    "value" DOUBLE PRECISION,

    CONSTRAINT "subscription_benefits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "membership_benefit_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "benefit_type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_benefit_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "razorpay_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "subscription_invoices" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "invoice_number" TEXT NOT NULL,
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gift_cards" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaser_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "recipient_id" TEXT,
    "message" TEXT,
    "razorpay_order_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gift_card_transactions" (
    "id" TEXT NOT NULL,
    "gift_card_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance_after" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "gift_card_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "geofences" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone_type" TEXT NOT NULL DEFAULT 'SERVICE_ZONE',
    "shape" TEXT NOT NULL DEFAULT 'CIRCLE',
    "city" TEXT,
    "state" TEXT,
    "center_lat" DOUBLE PRECISION NOT NULL,
    "center_lng" DOUBLE PRECISION NOT NULL,
    "radius_meters" DOUBLE PRECISION NOT NULL,
    "polygon" JSONB,
    "service_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "surge_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "geofence_events" (
    "id" TEXT NOT NULL,
    "geofence_id" TEXT NOT NULL,
    "user_id" TEXT,
    "provider_id" TEXT,
    "event_type" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "city_coverage_overrides" (
    "slug" TEXT NOT NULL,
    "status" TEXT,
    "note" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "city_coverage_overrides_pkey" PRIMARY KEY ("slug")
);

-- -------------------------------------------------------------- indexes
CREATE INDEX IF NOT EXISTS "ai_conversations_user_id_updated_at_idx" ON "ai_conversations"("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "membership_plans_is_active_idx" ON "membership_plans"("is_active");
CREATE INDEX IF NOT EXISTS "subscription_benefits_plan_id_idx" ON "subscription_benefits"("plan_id");
CREATE INDEX IF NOT EXISTS "membership_benefit_usage_user_id_idx" ON "membership_benefit_usage"("user_id");
CREATE INDEX IF NOT EXISTS "membership_benefit_usage_benefit_type_idx" ON "membership_benefit_usage"("benefit_type");
CREATE UNIQUE INDEX IF NOT EXISTS "membership_benefit_usage_user_id_benefit_type_period_key" ON "membership_benefit_usage"("user_id", "benefit_type", "period");
CREATE INDEX IF NOT EXISTS "user_subscriptions_user_id_idx" ON "user_subscriptions"("user_id");
CREATE INDEX IF NOT EXISTS "user_subscriptions_status_idx" ON "user_subscriptions"("status");
CREATE INDEX IF NOT EXISTS "user_subscriptions_plan_id_idx" ON "user_subscriptions"("plan_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_invoice_number_key" ON "subscription_invoices"("invoice_number");
CREATE INDEX IF NOT EXISTS "subscription_invoices_user_id_idx" ON "subscription_invoices"("user_id");
CREATE INDEX IF NOT EXISTS "subscription_invoices_subscription_id_idx" ON "subscription_invoices"("subscription_id");
CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_code_key" ON "gift_cards"("code");
CREATE INDEX IF NOT EXISTS "gift_cards_purchaser_id_idx" ON "gift_cards"("purchaser_id");
CREATE INDEX IF NOT EXISTS "gift_cards_recipient_id_idx" ON "gift_cards"("recipient_id");
CREATE INDEX IF NOT EXISTS "gift_cards_status_idx" ON "gift_cards"("status");
CREATE INDEX IF NOT EXISTS "gift_card_transactions_gift_card_id_idx" ON "gift_card_transactions"("gift_card_id");
CREATE INDEX IF NOT EXISTS "gift_card_transactions_user_id_idx" ON "gift_card_transactions"("user_id");
CREATE INDEX IF NOT EXISTS "geofences_is_active_idx" ON "geofences"("is_active");
CREATE INDEX IF NOT EXISTS "geofences_city_state_idx" ON "geofences"("city", "state");
CREATE INDEX IF NOT EXISTS "geofences_zone_type_idx" ON "geofences"("zone_type");
CREATE INDEX IF NOT EXISTS "geofence_events_geofence_id_created_at_idx" ON "geofence_events"("geofence_id", "created_at");
CREATE INDEX IF NOT EXISTS "geofence_events_user_id_created_at_idx" ON "geofence_events"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "geofence_events_provider_id_created_at_idx" ON "geofence_events"("provider_id", "created_at");
CREATE INDEX IF NOT EXISTS "geofence_events_event_type_idx" ON "geofence_events"("event_type");

-- ---------------------------------------------------------- foreign keys
DO $$ BEGIN
  ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- ai_conversations_user_id_fkey

DO $$ BEGIN
  ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- ai_messages_conversation_id_fkey

DO $$ BEGIN
  ALTER TABLE "subscription_benefits" ADD CONSTRAINT "subscription_benefits_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- subscription_benefits_plan_id_fkey

DO $$ BEGIN
  ALTER TABLE "membership_benefit_usage" ADD CONSTRAINT "membership_benefit_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- membership_benefit_usage_user_id_fkey

DO $$ BEGIN
  ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- user_subscriptions_plan_id_fkey

DO $$ BEGIN
  ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- user_subscriptions_user_id_fkey

DO $$ BEGIN
  ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- subscription_invoices_subscription_id_fkey

DO $$ BEGIN
  ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchaser_id_fkey" FOREIGN KEY ("purchaser_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- gift_cards_purchaser_id_fkey

DO $$ BEGIN
  ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- gift_cards_recipient_id_fkey

DO $$ BEGIN
  ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- gift_card_transactions_gift_card_id_fkey

DO $$ BEGIN
  ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- gift_card_transactions_user_id_fkey

DO $$ BEGIN
  ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$; -- geofence_events_geofence_id_fkey
