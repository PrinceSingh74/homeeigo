# Database Retention & Growth Control — Certification (REMEDIATION PHASE 2)

**Date:** 2026-06-18 · **Finding addressed:** `app_log_entries` = 1.24 GB ≈ 94% of the database, unbounded growth (load testing alone grew it to **2.44M rows**).

## What was implemented (real code)
- **`DataRetentionService.purgeAppLogEntries()`** (`src/services/data-retention.service.ts`) —
  batched (`ctid`-bounded raw delete, 5000/batch) purge of `app_log_entries` older than
  `APP_LOG_RETENTION_DAYS` (default **90d**). Avoids long locks / WAL spikes on the multi-million-row
  table. Tracked via `retention_job_runs` (job `DAILY_APP_LOG_PURGE`).
- **Scheduler wiring** (`src/lib/retention-scheduler.ts`) — added a leader-locked
  `retention:daily_app_log_purge` task to the existing daily tick (hour 3 UTC), alongside the
  pre-existing OTP / token / notification / audit-archive retention jobs.

This extends HOMIGO's existing retention engine (which already covered OTPs, refresh tokens,
notifications, and enterprise audit logs → `enterprise_audit_log_archives`) to the one
high-volume table it did **not** cover.

## EXECUTED demonstration (real before/after)
Backdated 1.2M rows to 120 days old, then ran the **actual service method**:

| Stage | `app_log_entries` rows | table size | DB size |
|-------|------------------------|-----------|---------|
| **Before** | 2,440,729 | 1241 MB | 1357 MB |
| Purge (`purgeAppLogEntries()`) | **deleted 1,200,000 in 6.36 s** | — | — |
| After purge | 1,240,729 | — | — |
| **After VACUUM FULL** | 1,240,729 | **627 MB** | **744 MB** |

- Job record: `retention_job_runs → DAILY_APP_LOG_PURGE | COMPLETED | records_processed=1,200,000`.
- Rows older than 90d after purge: **0**.
- **DB reclaim: 1357 MB → 744 MB = −613 MB (−45%).** Table: 1241 MB → 627 MB.

## Retention tiers
- **Hot (<90d, configurable):** retained in `app_log_entries` (live, indexed).
- **Cold (>90d):** purged by the daily job. (For regulated logs, the separate
  `enterprise_audit_log_archives` cold-store path already exists; app debug/system logs are
  purge-on-expiry per standard practice.)
- **Metric:** every run writes `records_processed` + cutoff to `retention_job_runs` (observable).

## Note (honest)
- Physical disk reclaim required **VACUUM FULL** (plain VACUUM only returns space to the table
  freelist). In production, schedule VACUUM FULL / `pg_repack` in a maintenance window, or rely on
  autovacuum to keep steady-state size bounded once the daily purge caps growth.
- Container `/dev/shm` blocked *parallel* vacuum (`VACUUM (PARALLEL 0)` used) — an environment
  limit, not a code issue.

## Verdict
**PASS** — retention implemented, scheduled, and **executed against live data**: 1.2M rows purged,
DB shrunk 45%, job tracked. Growth is now capped at a 90-day window.
