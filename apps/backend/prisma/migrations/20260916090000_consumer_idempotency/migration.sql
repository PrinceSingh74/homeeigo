-- ALLOW_DATA_LOSS: collapses EXACT duplicates by the unique key each index below then enforces,
-- keeping the earliest row (created_at, then id). Verified on production-shaped data before the
-- index was designed: scheduled_jobs is scoped to job_type='automation.review_request' ONLY,
-- because automation.workflow_step legitimately schedules several jobs per trigger_event_id — an
-- earlier (job_type, trigger_event_id) key was wrong for that type and is not used here.
-- Consumer idempotency under at-least-once delivery.
--
-- The event bus writes a consumer's receipt AFTER its handler succeeds, and the outbox reclaims a
-- PROCESSING row after 120 s. A crash (or a lease lapse with the original handler still running)
-- therefore re-runs handlers. Three consumers deduplicated with a read-then-write (findFirst, then
-- create), which is advisory under concurrency. These indexes make the database the arbiter, and
-- the handlers now claim by inserting and treating a unique violation as "already done".
--
-- Additive only. Existing exact duplicates are collapsed to the earliest row first so the unique
-- index can be created; the surviving row is the one every later read already returned.
--
-- SCOPE NOTE (scheduled_jobs): the key is (job_type, trigger_event_id) ONLY for job types where one
-- triggering event means exactly one job. `automation.workflow_step` is NOT such a type — every
-- step of a workflow instance carries the instance's trigger event id, so several step jobs per
-- event are correct. The index is therefore partial on the consumer-scheduled job type.

-- 1. One review-request job per triggering event.
DELETE FROM "scheduled_jobs" a
USING "scheduled_jobs" b
WHERE a."job_type" = 'automation.review_request'
  AND b."job_type" = 'automation.review_request'
  AND a."trigger_event_id" IS NOT NULL
  AND a."trigger_event_id" = b."trigger_event_id"
  AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));

CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_jobs_review_request_trigger_event_id_key"
  ON "scheduled_jobs" ("trigger_event_id")
  WHERE "trigger_event_id" IS NOT NULL AND "job_type" = 'automation.review_request';

-- 2. One ML feature staging row per event.
DELETE FROM "ml_feature_staging" a
USING "ml_feature_staging" b
WHERE a."event_id" = b."event_id"
  AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));

CREATE UNIQUE INDEX IF NOT EXISTS "ml_feature_staging_event_id_key"
  ON "ml_feature_staging" ("event_id");

-- 3. Partner-referral notifications: one per (recipient, referral, title). Partial: only this
--    reference type is deduplicated this way; other notification types are governed elsewhere.
DELETE FROM "notifications" a
USING "notifications" b
WHERE a."reference_type" = 'partner_referral'
  AND b."reference_type" = 'partner_referral'
  AND a."user_id" IS NOT DISTINCT FROM b."user_id"
  AND a."reference_id" IS NOT DISTINCT FROM b."reference_id"
  AND a."title" = b."title"
  AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_partner_referral_dedup_key"
  ON "notifications" ("user_id", "reference_id", "title")
  WHERE "reference_type" = 'partner_referral';
