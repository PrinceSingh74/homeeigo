-- HOMIGO booking uniqueness — permanent DB-level guard against double-booking.
-- Slot identity = (user_id, service_id, scheduled_date); scheduled_date is a full timestamp
-- (scheduled_time is unused/NULL). Terminal states (cancelled/rejected) are excluded so a user can
-- re-book a slot after cancelling. COMPLETED is included so the exact same paid slot can't recur.
--
-- STEP 1 — non-destructive de-dup of pre-existing seed rows: these are SEPARATE paid bookings the seed
-- mislabelled with identical timestamps. We nudge the redundant ones by N seconds (NEVER delete — they
-- carry real payments/ratings/ledger rows) so the unique index can be built with zero financial loss.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, service_id, scheduled_date ORDER BY created_at, id) AS rn
  FROM bookings
  WHERE status NOT IN ('CANCELLED_BY_USER','CANCELLED_BY_PROVIDER','REJECTED')
)
UPDATE bookings b
SET scheduled_date = b.scheduled_date + ((r.rn - 1) || ' seconds')::interval
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

-- STEP 2 — the permanent guard. Any INSERT/UPDATE from ANY source (Prisma API, admin, seed, jobs,
-- imports, raw SQL) that would create a 2nd non-terminal booking for the same user+service+slot fails.
CREATE UNIQUE INDEX IF NOT EXISTS booking_unique_active_slot
  ON bookings (user_id, service_id, scheduled_date)
  WHERE status NOT IN ('CANCELLED_BY_USER','CANCELLED_BY_PROVIDER','REJECTED');
