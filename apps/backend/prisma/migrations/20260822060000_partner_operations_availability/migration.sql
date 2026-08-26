-- Section 02: Partner Operations — availability, capacity, pause, timezone.
-- Extends Provider; does not introduce a second availability or geo table.

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "max_jobs_per_day" INTEGER;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "max_concurrent_jobs" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "break_windows" JSONB;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMP(3);
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "pause_reason" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

CREATE INDEX IF NOT EXISTS "providers_paused_at_idx" ON "providers"("paused_at");
CREATE INDEX IF NOT EXISTS "providers_current_status_idx" ON "providers"("current_status");

ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_max_concurrent_jobs_range";
ALTER TABLE "providers" ADD CONSTRAINT "providers_max_concurrent_jobs_range"
  CHECK ("max_concurrent_jobs" >= 1 AND "max_concurrent_jobs" <= 20);

ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_max_jobs_per_day_range";
ALTER TABLE "providers" ADD CONSTRAINT "providers_max_jobs_per_day_range"
  CHECK ("max_jobs_per_day" IS NULL OR ("max_jobs_per_day" >= 1 AND "max_jobs_per_day" <= 50));
