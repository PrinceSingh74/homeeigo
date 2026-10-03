-- Queue position and wait estimate were full-table aggregates on every booking creation.
--
-- `bookingPriorityService.enqueue` runs, per create: AVG(wait_time_ms) by priority, plus one or two
-- COUNT(*) of pending unassigned bookings by priority. With no supporting index these scan the whole
-- `bookings` table, so booking creation got slower as the table grew — measured with
-- pg_stat_statements under the certification load profile at 21,715 rows: 14.9 ms, 26.2 ms and
-- 16.1 ms mean per call, together the top three statements by total time in the whole workload.
--
-- Both predicates are highly selective (only PENDING and unassigned; only rows that have a recorded
-- wait), so partial indexes turn these into small index scans that do not grow with history.
--
-- Additive and re-runnable: two indexes, no column touched, no row rewritten.
CREATE INDEX IF NOT EXISTS "bookings_queue_pending_idx"
  ON "bookings" ("queue_priority")
  WHERE "status" = 'PENDING' AND "provider_id" IS NULL;

CREATE INDEX IF NOT EXISTS "bookings_wait_time_by_priority_idx"
  ON "bookings" ("queue_priority")
  INCLUDE ("wait_time_ms")
  WHERE "wait_time_ms" IS NOT NULL;
