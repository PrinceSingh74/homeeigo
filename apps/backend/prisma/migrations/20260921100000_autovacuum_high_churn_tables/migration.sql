-- Per-table autovacuum tuning for tables that are written and deleted constantly.
--
-- MEASURED PROBLEM (homigo_db, 2026-09-21)
-- ----------------------------------------
--   provider_match_scores   1 row      31,629 heap pages (247 MB) + 82 MB indexes = 329 MB
--   otps                    1 row      1 heap page (8 KB)         + 20 MB indexes =  20 MB
--
-- `provider_match_scores` is the largest object in a 1,060 MB database and holds one row. Its
-- 7-day retention (MATCH_SCORE_RETENTION_DAYS, data-retention.service.ts) is working exactly as
-- designed — it is the space reclamation that never happened. `otps` shows the same disease in the
-- indexes rather than the heap.
--
-- WHY THE DEFAULTS FAIL ON THESE TABLES
-- -------------------------------------
-- Autovacuum is on, with `autovacuum_vacuum_scale_factor = 0.2`: vacuum after roughly 20% of the
-- table's estimated rows have changed. On a table that is repeatedly filled and then almost
-- entirely emptied, the estimate collapses towards zero after each sweep, so the 20% trigger is
-- computed against a tiny row count while the FILE stays large. The table is simultaneously
-- "small" to the planner and enormous on disk, and index cleanup lags worst of all.
--
-- A fixed, low threshold is the right shape here: vacuum after a known number of dead rows rather
-- than a proportion of a number that keeps resetting.
--
-- WHAT THIS DOES AND DOES NOT DO
-- ------------------------------
-- These settings stop the bloat RECURRING. They do NOT shrink the files that are already bloated —
-- plain VACUUM makes space reusable, it does not return it to the operating system. Reclaiming the
-- existing 349 MB needs VACUUM FULL / REINDEX, which take an ACCESS EXCLUSIVE lock and are
-- therefore an operator action in a maintenance window, not a migration. The runbook is in
-- docs/enterprise-2035-database-hygiene.md.
--
-- No data is read, written or deleted here; these are storage parameters only.

-- Retention empties this table daily; without a fixed threshold the proportional trigger never
-- keeps up with the churn.
ALTER TABLE "provider_match_scores" SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 500,
  autovacuum_vacuum_cost_delay = 0
);

-- Same pattern, expressed as index bloat: the heap is one page, the indexes are 20 MB.
ALTER TABLE "otps" SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 200,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 200,
  autovacuum_vacuum_cost_delay = 0
);

-- Expired/rotated tokens are deleted continuously by the retention scheduler.
ALTER TABLE "refresh_tokens" SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 1000
);

-- Append-heavy with periodic archival deletes. A 20% proportional trigger on a 400k-row table means
-- 80,000 dead rows accumulate before anything happens.
ALTER TABLE "enterprise_audit_logs" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 5000
);

-- Append-only today and NOT covered by any retention policy (173,197 rows / 186 MB on 2026-09-21).
-- Tuning autovacuum keeps the statistics honest; it does nothing about the growth itself, which
-- needs a retention decision from the data owner — see docs/enterprise-2035-database-hygiene.md.
ALTER TABLE "assignment_audits" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 5000
);

-- High-volume consumer bookkeeping; grows with every event fan-out.
ALTER TABLE "event_consumer_receipts" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 5000
);

ALTER TABLE "activity_logs" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 5000
);

-- The table behind the 699 MB log explosion that produced the log-governance barriers. Those
-- barriers hold — it is down to 2,642 rows — but the file did not follow: 4,177 heap pages and
-- 17 MB of indexes for 2,642 rows, i.e. 50 MB carrying ~3 MB of data. Governance stopped the
-- writes; nothing reclaimed what the writes left behind.
ALTER TABLE "app_log_entries" SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 2000,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 2000,
  autovacuum_vacuum_cost_delay = 0
);
