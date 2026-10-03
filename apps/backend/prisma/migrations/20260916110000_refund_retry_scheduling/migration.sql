-- Persist refund retry state on the refund row instead of deriving it by counting audit rows.
--
-- The retry scan took the 25 oldest FAILED refunds by updated_at and counted each one's RETRY audits
-- to decide whether its 5 attempts were spent. An exhausted row was skipped BEFORE anything wrote to
-- it, so its updated_at froze while live rows kept theirs refreshed -- exhausted rows drifted to the
-- front of the ordering and stayed. Once 25 accumulated they filled the window permanently and a
-- customer whose refund failed afterwards was never retried again, silently.
--
-- Additive only: two new columns and one index. No column is dropped, no row is deleted, and the
-- backfill derives each value from existing audit rows rather than overwriting anything.

ALTER TABLE "refund_requests"
  ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMP(3);

-- Derive the attempt count already recorded in the audit trail, so existing exhausted refunds stay
-- exhausted and existing live ones keep the attempts they have left.
UPDATE "refund_requests" r
SET "retry_count" = COALESCE(a.n, 0)
FROM (
  SELECT "refund_request_id", COUNT(*)::int AS n
  FROM "refund_audits"
  WHERE "action" = 'RETRY'
  GROUP BY "refund_request_id"
) a
WHERE a."refund_request_id" = r."id";

-- The scan's predicate: status + eligibility time, with the attempt count available on the row.
CREATE INDEX IF NOT EXISTS "refund_requests_status_next_retry_at_idx"
  ON "refund_requests" ("status", "next_retry_at");
