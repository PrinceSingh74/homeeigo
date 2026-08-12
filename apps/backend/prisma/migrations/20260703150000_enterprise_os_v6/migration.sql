-- Enterprise OS V6 — additive intelligence tables

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "cost" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "cx_survey_responses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "booking_id" TEXT,
    "survey_type" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cx_survey_responses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cx_survey_responses_survey_type_created_at_idx" ON "cx_survey_responses"("survey_type", "created_at");
CREATE INDEX IF NOT EXISTS "cx_survey_responses_user_id_idx" ON "cx_survey_responses"("user_id");

CREATE TABLE IF NOT EXISTS "marketing_attribution_touches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "channel" TEXT NOT NULL,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_attribution_touches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "marketing_attribution_touches_user_id_idx" ON "marketing_attribution_touches"("user_id");
CREATE INDEX IF NOT EXISTS "marketing_attribution_touches_channel_idx" ON "marketing_attribution_touches"("channel");
CREATE INDEX IF NOT EXISTS "marketing_attribution_touches_created_at_idx" ON "marketing_attribution_touches"("created_at");

CREATE TABLE IF NOT EXISTS "platform_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_pct" INTEGER NOT NULL DEFAULT 100,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "is_kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_feature_flags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_feature_flags_key_key" ON "platform_feature_flags"("key");
CREATE INDEX IF NOT EXISTS "platform_feature_flags_environment_idx" ON "platform_feature_flags"("environment");

CREATE TABLE IF NOT EXISTS "platform_feature_flag_history" (
    "id" TEXT NOT NULL,
    "flag_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "rollout_pct" INTEGER NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_feature_flag_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "platform_feature_flag_history_flag_key_idx" ON "platform_feature_flag_history"("flag_key");
CREATE INDEX IF NOT EXISTS "platform_feature_flag_history_created_at_idx" ON "platform_feature_flag_history"("created_at");

CREATE TABLE IF NOT EXISTS "platform_experiments" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "variants" JSONB NOT NULL DEFAULT '[]',
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_experiments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_experiments_key_key" ON "platform_experiments"("key");
