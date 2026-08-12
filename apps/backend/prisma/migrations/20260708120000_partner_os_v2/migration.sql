-- Partner OS V2 — attendance, incentives, academy, wellbeing

CREATE TABLE IF NOT EXISTS "partner_attendance_sessions" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_attendance_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "partner_attendance_sessions_provider_id_check_in_at_idx" ON "partner_attendance_sessions"("provider_id", "check_in_at");

ALTER TABLE "partner_attendance_sessions" ADD CONSTRAINT "partner_attendance_sessions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "partner_incentive_rules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "bonus_amount" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partner_incentive_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_incentive_rules_code_key" ON "partner_incentive_rules"("code");

CREATE TABLE IF NOT EXISTS "partner_incentive_payouts" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREDITED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_incentive_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_incentive_payouts_provider_id_rule_id_period_key_key" ON "partner_incentive_payouts"("provider_id", "rule_id", "period_key");
CREATE INDEX IF NOT EXISTS "partner_incentive_payouts_provider_id_idx" ON "partner_incentive_payouts"("provider_id");

ALTER TABLE "partner_incentive_payouts" ADD CONSTRAINT "partner_incentive_payouts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_incentive_payouts" ADD CONSTRAINT "partner_incentive_payouts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "partner_incentive_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "partner_academy_modules" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_url" TEXT,
    "body" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "category_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partner_academy_modules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_academy_modules_slug_key" ON "partner_academy_modules"("slug");

CREATE TABLE IF NOT EXISTS "partner_academy_progress" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_academy_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_academy_progress_provider_id_module_id_key" ON "partner_academy_progress"("provider_id", "module_id");
CREATE INDEX IF NOT EXISTS "partner_academy_progress_provider_id_idx" ON "partner_academy_progress"("provider_id");

ALTER TABLE "partner_academy_progress" ADD CONSTRAINT "partner_academy_progress_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_academy_progress" ADD CONSTRAINT "partner_academy_progress_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "partner_academy_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "platform_wellbeing_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "sos_phone" TEXT,
    "insurance_url" TEXT,
    "community_url" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_wellbeing_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "partner_incentive_rules" ("id", "code", "name", "period", "metric", "threshold", "bonus_amount", "is_active", "updated_at")
VALUES
  ('inc_daily_3', 'DAILY_3_JOBS', 'Daily Bonus', 'DAILY', 'completed_jobs', 3, 150, true, NOW()),
  ('inc_weekly_18', 'WEEKLY_18_JOBS', 'Weekly Bonus', 'WEEKLY', 'completed_jobs', 18, 800, true, NOW()),
  ('inc_monthly_75', 'MONTHLY_75_JOBS', 'Monthly Bonus', 'MONTHLY', 'completed_jobs', 75, 3500, true, NOW()),
  ('inc_streak_7', 'STREAK_7_DAYS', 'Streak Reward', 'STREAK', 'active_days', 7, 500, true, NOW())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "platform_wellbeing_config" ("id", "sos_phone", "insurance_url", "community_url", "updated_at")
VALUES ('default', '112', NULL, NULL, NOW())
ON CONFLICT ("id") DO NOTHING;
