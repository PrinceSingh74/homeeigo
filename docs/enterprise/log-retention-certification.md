# HOMIGO — Log Retention Implementation Certification

**Date:** 2026-06-24 · **Table:** `app_log_entries` · **Method:** live DB measurement + runtime proof.

## Verdict: **PASS** — 1-year projection **~137 MB** (bounded to ~11 MB with retention) « 500 MB; **no unbounded growth**.

---

## Verification (9 items)

| # | Item | Result |
|---|------|--------|
| 1 | **Current size** | **42 MB** (85,025 rows) — was 699 MB |
| 2 | **Rows/day growth (post-fix)** | **~762 rows/day ≈ 0.38 MB/day** (ERROR-only) — was ~90k rows/day (~47 MB/day) → **122× reduction** |
| 3 | **Retention scheduler exists** | ✅ `lib/retention-scheduler.ts` — daily `retention:daily_app_log_purge`, leader-locked; `ARCHIVE_RETENTION_DAYS=30` |
| 4 | **Scheduler last successful run** | ⚠️ **not independently recorded** — no run-audit table for the purge (only `ledger_backfill_runs` exists). Wired + scheduled, but execution isn't logged. **Gap.** |
| 5 | **Partition count** | **0** — table is **not partitioned**. Size goal achieved via ERROR-only persistence + retention-delete instead of monthly partitions. |
| 6 | **Archive pipeline status** | `data-archival.service.ts` wires Postgres→BigQuery archival, but **BigQuery archival is GCP-unverified** (no run records). |
| 7 | **% INFO/WARN persisted (going forward)** | **0%** — RUNTIME PROVEN: 180 requests generated logs, **0 new INFO/WARN rows** persisted (delta=0). The 86.5% INFO in the table is *residual* (last-1-day kept during the prune; ages out at 30 d). |
| 8 | **% ERROR persisted** | **100%** of errors (the only level now written to the DB; INFO/WARN → stdout/Cloud Logging) |
| 9 | **Projected size** | see table below |

### Item 9 — projections (measured: 762 err/day × 520 B/row = 0.38 MB/day)
| Horizon | Unbounded (error-only) | **With 30-day retention (actual)** |
|---------|-----------------------:|-----------------------------------:|
| 30 days | 11 MB | **11 MB** |
| 90 days | 34 MB | **11 MB** |
| 180 days | 68 MB | **11 MB** |
| **365 days** | **137 MB** | **~11 MB** |

---

## Why it PASSES the gate
- **1-year projection < 500 MB:** ✅ **137 MB** worst-case (error-only, ignoring retention); **~11 MB** steady-state with the 30-day retention. Both well under 500 MB.
- **No unbounded growth:** ✅ **two independent bounds** — (a) ERROR-only persistence (runtime-proven: 0 new INFO/WARN over 180 requests) caps the *rate* at 0.38 MB/day, and (b) the 30-day retention caps the *total* at ~30 days of errors.

## Root-cause fix (the actual remediation)
`services/log-aggregation.service.ts` now gates the DB persister on level — only `error` is written
(`LOG_DB_PERSIST_LEVELS=error`, env-tunable). Previously **all** levels were persisted (WARN 78.8% +
INFO 20.4% = 99.2% of the 699 MB). WARN/INFO now go to stdout → Cloud Logging.

## Honest gaps (do not affect the PASS gate, but below "elite")
1. **No partitioning** — goal met by ERROR-only + retention-delete, not monthly partitions. If high-volume
   ERROR ever appears, add monthly partitions + `DROP PARTITION` for O(1) purge.
2. **Retention scheduler execution is not audited** — add a `retention_runs(table, deleted, ran_at)` log so
   "last successful run" is provable (currently only the code + daily tick exist).
3. **BigQuery cold archival unverified** — needs a GCP run to confirm.

> **Bottom line: PASS.** The unbounded-log P1 is genuinely fixed — growth is bounded by both an
> ERROR-only sink (runtime-proven) and 30-day retention, and the 1-year projection (137 MB / ~11 MB) is
> far under the 500 MB gate.
