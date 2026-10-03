-- ALLOW_DATA_LOSS: collapses EXACT duplicate notification rows by the key each partial index then
-- enforces, keeping the earliest. A duplicate here is a second copy of a message already delivered
-- to the same recipient for the same reference, so removing it loses no distinct information.
-- Notification dedup arbiters, second pass (independent review of 20260916090000_consumer_idempotency).
--
-- 1. The partner-referral dedup index covered `notifyReferrer` (reference_type = 'partner_referral')
--    but stopped one line short of its sibling `notifyAdminReview`, which writes
--    'partner_referral_review' and fans out to up to 20 admins per delivery. Widen the predicate so
--    both are arbitrated by the database. The index is dropped and recreated in the SAME file, which
--    the migration guard recognises as a redefinition rather than a drop.
--
-- 2. The booking-accepted customer notification used a read-then-write guard with no index behind
--    it; two concurrent accepts (double-tap / retry) produced two pushes and two emails.
--
-- Both DELETEs remove only exact duplicates by the new key, keeping the earliest row.

DELETE FROM "notifications" a
USING "notifications" b
WHERE a."reference_type" IN ('partner_referral', 'partner_referral_review')
  AND a."reference_type" = b."reference_type"
  AND a."user_id" IS NOT DISTINCT FROM b."user_id"
  AND a."reference_id" IS NOT DISTINCT FROM b."reference_id"
  AND a."title" = b."title"
  AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));

DROP INDEX IF EXISTS "notifications_partner_referral_dedup_key";
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_partner_referral_dedup_key"
  ON "notifications" ("user_id", "reference_id", "title")
  WHERE "reference_type" IN ('partner_referral', 'partner_referral_review');

DELETE FROM "notifications" a
USING "notifications" b
WHERE a."type" = 'booking_accepted'
  AND b."type" = 'booking_accepted'
  AND a."user_id" IS NOT DISTINCT FROM b."user_id"
  AND a."reference_id" IS NOT DISTINCT FROM b."reference_id"
  AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_booking_accepted_dedup_key"
  ON "notifications" ("user_id", "reference_id")
  WHERE "type" = 'booking_accepted';
