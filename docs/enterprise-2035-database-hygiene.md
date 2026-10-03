# HOMEEIGO — Database Hygiene

**Status: RECURRENCE FIXED IN CODE · EXISTING 399 MB REQUIRES AN OPERATOR MAINTENANCE WINDOW**

Corrects audit findings **DB-1**, **DB-2** and **DB-3**, two of which were wrong.

---

## 1. Correcting the audit

| Audit claim | Reality |
|---|---|
| "Autovacuum has **never run** on any table" (DB-2, P1) | **Unsupportable.** Autovacuum is **on** with defaults and `track_counts` is on. Every counter in `pg_stat_user_tables` reads 0 and `pg_stat_database.stats_reset` is NULL — the statistics were **lost**, almost certainly with a container restart (Docker Desktop instability is on record for this environment). `last_autovacuum = never` meant "no statistics", not "never vacuumed". |
| "575k audit rows with **no retention**" (DB-3, P1) | **Half wrong.** `enterprise_audit_logs` **is** covered — `data-retention.service.ts` archives then deletes it by retention category (SECURITY_EVENTS 7y, PAYMENT_EVENTS 8y, FINANCIAL_LEDGER 10y, LOGIN_EVENTS 2y, SYSTEM_LOGS 1y). `assignment_audits` genuinely has none. |
| "`otps` — 13 rows, 20 MB" (heap bloat implied) | **Wrong shape.** The heap is **one 8 KB page**. All 20 MB is **index** bloat, which `VACUUM FULL` alone does not fix — it needs `REINDEX`. |
| "`provider_match_scores` — 1 row, 329 MB" (DB-1, P1) | **Correct and confirmed.** 31,629 heap pages (247 MB) + 82 MB indexes. |

The corrected diagnosis matters because the three problems have three different remedies, and the audit's framing would have led to the wrong one twice.

---

## 2. Measured state (`homigo_db`, 1,059.9 MB, 2026-09-21)

| Table | Live rows | Pages | Heap | Indexes | Total | Classification |
|---|---|---|---|---|---|---|
| `provider_match_scores` | **1** | 31,629 | 247.1 MB | 81.9 MB | **329.1 MB** | **BLOAT** |
| `assignment_audits` | 173,197 | 4,682 | 150 MB | 37 MB | 186.3 MB | **GROWTH** (no retention) |
| `enterprise_audit_logs` | 365,784 | 18,263 | 156 MB | 104 MB | 260 MB | Real data, retention covered |
| `app_log_entries` | **2,642** | 4,177 | 32.6 MB | 17.3 MB | **50.0 MB** | **BLOAT** |
| `otps` | **1** | **1** | 8 KB | **20.2 MB** | **20.2 MB** | **BLOAT (index only)** |
| `refresh_tokens` | 14,597 | 1,567 | 13 MB | 13 MB | 26 MB | Borderline |

**~399 MB of a 1,060 MB database is space that retention already freed and nothing returned.**

### Two problems that look identical and are not

- **BLOAT** — many pages, few live rows. Retention *worked*; the file never shrank. Fixed by `VACUUM FULL` / `REINDEX`. **Deleting rows does nothing.**
- **GROWTH** — many pages, many live rows, no retention policy. The data is real. Fixed by a retention decision, which is a business call.

Treating growth as bloat wastes a maintenance window. Treating bloat as growth deletes live data to fix something deletion cannot fix.

---

## 3. Root cause of the bloat

Autovacuum runs with `autovacuum_vacuum_scale_factor = 0.2` — vacuum once ~20 % of the table's *estimated* rows have changed.

On a table that is repeatedly filled and then almost entirely emptied, that estimate collapses toward zero after each sweep. The trigger is then computed against a tiny row count while the **file** stays large, so the table is simultaneously "small" to the planner and enormous on disk. Index cleanup lags worst of all — which is exactly why `otps` shows one heap page and 20 MB of indexes.

`provider_match_scores` is the clearest case: its 7-day retention (`MATCH_SCORE_RETENTION_DAYS`) is working perfectly — it holds one row — and it is still the largest object in the database.

**Nothing was watching the space retention left behind.** That is the actual gap, and it is the one now closed.

---

## 4. What was changed

### `prisma/migrations/20260921100000_autovacuum_high_churn_tables/migration.sql`

Per-table autovacuum storage parameters for 8 high-churn tables. Fixed thresholds replace proportional ones on the delete-heavy tables, because a proportion of a number that keeps resetting is not a useful trigger:

| Table | scale_factor | threshold |
|---|---|---|
| `provider_match_scores` | 0.0 | 500 |
| `otps` | 0.0 | 200 |
| `app_log_entries` | 0.0 | 2000 |
| `refresh_tokens` | 0.01 | 1000 |
| `enterprise_audit_logs`, `assignment_audits`, `event_consumer_receipts`, `activity_logs` | 0.02 | 5000 |

Storage parameters only — **no data is read, written or deleted**. Validated on an isolated clone: migrations apply cleanly, all 8 tables carry the settings, and `verify-migration-authority.ts` still reports **29/29 PASS**.

**This stops recurrence. It does not shrink the files that are already bloated** — plain `VACUUM` makes space reusable; only `VACUUM FULL` returns it to the OS.

### `scripts/check-db-hygiene.ts` — new, read-only

Classifies every large table as BLOAT or GROWTH and prescribes the matching remedy, rather than reporting a size and leaving the diagnosis to whoever reads it. Also flags bloated tables that lack per-table autovacuum settings, since those will re-bloat after any maintenance window.

It immediately earned its place: **it found `app_log_entries`**, which this work had missed — the very table behind the 699 MB log explosion that produced the log-governance barriers. Those barriers hold (2,642 rows), but the file did not follow: 50 MB carrying roughly 3 MB of data. It was added to the migration as a result.

Output on live:

```
[BLOAT ] provider_match_scores   1 live rows in 31,629 pages · heap 247.1 MB · indexes 81.9 MB
[GROWTH] assignment_audits       173,197 live rows · total 186.3 MB · NO retention policy
[BLOAT ] app_log_entries         2,642 live rows in 4,177 pages · heap 32.6 MB · indexes 17.3 MB
[BLOAT ] otps                    1 live rows in 1 pages · heap 0.0 MB · indexes 20.2 MB
```

On a freshly-built database it exits **0 / PASS**.

---

## 5. Operator runbook — reclaiming the 399 MB

**Not performed here.** `VACUUM FULL` and `REINDEX` take an `ACCESS EXCLUSIVE` lock: the table is unavailable for the duration, so this is a maintenance-window action.

```bash
# 0. Back up first.
cd apps/backend && bun run backup:db

# 1. Apply the autovacuum migration so the bloat cannot rebuild afterwards.
DATABASE_URL="postgresql://<user>:<pass>@<host>:5433/homigo_db" bunx prisma migrate deploy

# 2. Reclaim. Largest first; each locks its table.
#    provider_match_scores ~329 MB -> expect < 1 MB
psql "$DATABASE_URL" -c 'VACUUM (FULL, ANALYZE) provider_match_scores;'
psql "$DATABASE_URL" -c 'VACUUM (FULL, ANALYZE) app_log_entries;'

#    otps is INDEX bloat — VACUUM FULL rebuilds indexes too, but REINDEX alone is enough and
#    cheaper, since the heap is a single page.
psql "$DATABASE_URL" -c 'REINDEX TABLE CONCURRENTLY otps;'

# 3. Verify.
bun run scripts/check-db-hygiene.ts --url "$DATABASE_URL"
```

`REINDEX ... CONCURRENTLY` avoids the exclusive lock and is preferred on a live system. `VACUUM FULL` has no concurrent equivalent; `pg_repack` is the alternative if downtime is unacceptable.

Expected result: database drops from ~1,060 MB to roughly **660 MB**, with no row deleted.

---

## 6. Open — requires a data-owner decision

### DBH-4 — `assignment_audits` has no retention policy

173,197 rows / 186 MB, append-only, growing with every dispatch. Every other audit-shaped table in the platform has a retention category; this one was never assigned one.

**Deliberately not fixed in code.** Adding a `deleteMany` to a dispatch audit trail is a compliance decision, not a cleanup: it determines how far back a disputed assignment can be reconstructed. The correct next step is to assign it a retention category in `data-retention.service.ts` alongside the existing ones, with the period chosen by whoever owns dispatch disputes.

Autovacuum tuning has been applied to it regardless, so its statistics stay honest while the decision is pending.

---

## 7. Status

| Item | Status |
|---|---|
| Bloat root cause identified and measured | **VERIFIED** |
| Recurrence prevented (8 tables tuned) | **FIXED** — validated on isolated clone |
| Ongoing hygiene monitoring | **ADDED** — `check-db-hygiene.ts`, non-zero exit on findings |
| `app_log_entries` bloat | **FOUND by the new check**, added to the migration |
| Existing 399 MB reclamation | **PENDING OPERATOR** — runbook §5 |
| `assignment_audits` retention | **OPEN — data-owner decision** |
| Audit claim "autovacuum never ran" | **WITHDRAWN** — statistics were lost, not vacuum |
| Audit claim "audit tables have no retention" | **WITHDRAWN for `enterprise_audit_logs`**, stands for `assignment_audits` |
| Audit claim "`otps` heap bloat" | **CORRECTED** — index bloat; needs REINDEX |

---

## Pass 6 re-measurement (2026-09-21)

`check-db-hygiene.ts` again on live: **1,069.8 MB total**, the same three bloated tables
(`provider_match_scores` 329 MB / 1 row, `app_log_entries` 50 MB, `otps` 20 MB) and the same
unretained one (`assignment_audits`). Two corrections to the figures above:

| Item | Earlier figure | Measured now | Why they differ |
|---|---|---|---|
| `assignment_audits` rows | 173,197 | **431,710** (`count(*)`) | 173,197 was `pg_class.reltuples`, stale since the last analyze. Composition by month: Jun 149,065 · Jul 190,396 · Aug 91,313 · Sep **936**. The table is not growing now (4–31 rows/day this week); 99.8% of it is the June–August dispatch-storm history. The retention decision stands as BUSINESS_DECISION, with the size of the decision now known. |
| autovacuum activity | "never" | `last_autovacuum` NULL and `n_live_tup = 0` on a 431k-row table | The cumulative statistics were lost at the 09:06 UTC restart that relocated Docker to D: (`pg_stat_database.stats_reset` = never; PostgreSQL drops in-memory stats on an unclean shutdown). Not a defect in the autovacuum settings — `20260921100000` is applied and `reloptions` show it — but autovacuum triggers on counters that restarted at zero. |

Action taken: a plain, non-blocking `VACUUM (ANALYZE)` on the four flagged tables (SHARE UPDATE
EXCLUSIVE lock; no rewrite, no data change). `reltuples` and `n_live_tup` now agree
(`app_log_entries` 3,708 · `assignment_audits` 431,710 · `otps` 13 · `provider_match_scores` 1) and
the planner has fresh statistics. It does **not** return the bloated space — `VACUUM FULL` still
needs a maintenance window and remains **OPERATOR_ACTION**; not run here.
