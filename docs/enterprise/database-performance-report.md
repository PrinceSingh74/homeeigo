# HOMIGO — Database Performance Report

**Generated:** 2026-06-09
**Method:** `EXPLAIN (ANALYZE, BUFFERS)` against live `homigo_db`, plus `pg_stat_user_tables` / `pg_stat_database`.
**Verdict:** No missing indexes on hot money/booking paths; one application-level N+1 mitigated via cache; sequential scans on hot tables are plan-optimal at current cardinality.

---

## 1. Hot Query Analysis (EXPLAIN ANALYZE, live DB)

| # | Query | Plan | Exec time | Index used | Finding |
|---|---|---|---|---|---|
| 1 | Booking search / catalog list (`services WHERE is_active ORDER BY popularity LIMIT 20`) | Seq Scan + quicksort | **0.55 ms** | n/a (18 rows) | Seq scan optimal at this size; `services_popularity_idx` + `services_is_active_idx` exist for growth |
| 2 | Booking create slot-conflict probe (`bookings` by provider_id + status + date) | Seq Scan | **0.13 ms** | `bookings_provider_id_status_idx` available | Planner picks seq scan at 5 rows; index ready at scale |
| 3 | Booking update row-lock (`bookings WHERE id FOR UPDATE`) | LockRows + Seq Scan | **0.12 ms** | PK | Correct `FOR UPDATE` lock, no contention |
| 4 | Wallet verify (`wallet_transactions` by reference_id + type + status) | Seq Scan | **0.12 ms** | `wallet_transactions_reference_id_idx` + `wallet_txn_razorpay_order_active_unique` | Indexes present; planner uses seq scan at 7 rows |
| 5 | Payment verify (`payments` by razorpay_order_id) | Seq Scan | **0.04 ms** | `payments_razorpay_order_id_key` (unique) available | Unique index ready; seq scan at 4 rows |
| 6 | Gift card redeem (`gift_cards` by code) | **Index Scan** `gift_cards_code_key` | 3.55 ms | unique index | Index-driven (3.5 ms is cold-buffer read; hot = sub-ms) |

**Interpretation:** All execution times are sub-millisecond except a single cold-buffer index read. The seq scans observed are the **planner's correct choice** because the dev DB holds only 4–18 rows per table — a seq scan is cheaper than an index probe below ~100 rows. The required indexes already exist (see §2), so plans flip to index scans automatically as data grows.

## 2. Index Inventory (hot tables)

53 indexes confirmed present across `services`, `bookings`, `payments`, `wallet_transactions`, `gift_cards`, including the critical ones for each hot path:

- `bookings_provider_id_status_idx`, `bookings_provider_slot_excl` (GiST exclusion), `bookings_user_slot_excl`
- `payments_razorpay_order_id_key`, `payments_idempotency_key_key`
- `wallet_transactions_reference_id_idx`, `wallet_txn_razorpay_order_active_unique`, `wallet_transactions_user_id_status_idx`
- `gift_cards_code_key`, `services_popularity_idx`

**Conclusion: no missing index** on any analyzed hot path.

## 3. N+1 Detection & Fix

**Finding N+1-001 — catalog ratings.** `CatalogService.featured/search/list` fetch services, then call `ratingsForServices()`. This was already **batched** (single `rating.findMany` with `serviceId IN (...)`), so it is N+1-safe.

**Finding PERF-001 — homepage list uncached.** `CatalogService.list()` (the single hottest read, driving 15,960 seq scans on `services` during load tests) ran the DB query on every request.

- **Fix:** wrapped `list()` in `cacheService.getOrFetch` with a 60 s Redis TTL **plus a new 10 s in-process L1 micro-cache** (added to `CacheService.getOrFetch`). Under thousands of concurrent VUs the L1 removes a Redis round-trip per request, which was the latency floor.
- **Evidence:** see load-testing-report.md booking P95 before/after.

## 4. Lock Contention & Deadlocks

```
pg_stat_database (homigo_db):
  deadlocks  = 0
  conflicts  = 0
  temp_files = 2
  blks_hit   = 28,557,703
  blks_read  = 192,999   → cache hit ratio 99.33%
```

- **0 deadlocks**, **0 conflicts** across the entire DB lifetime including all concurrent load tests and the 200-way concurrent money simulation.
- Buffer cache hit ratio **99.33%** — working set fully in memory.
- Booking concurrency uses GiST exclusion constraints (`bookings_provider_slot_excl`) + `FOR UPDATE`, proven race-safe by `release-blocker-wave2.test.ts`.

## 5. Risk & Rollback

- Cache change is read-only and fail-open (cache outage → direct DB read, never wrong data). Rollback = remove `l1Sec` argument.
- No index changes were required, so no migration risk.

## 6. Confidence

**HIGH** for "no missing indexes / 0 deadlocks" (direct execution evidence). **MEDIUM** for absolute latency claims at production data volume — the dev DB is small; re-run EXPLAIN against a production-sized dataset to confirm planner flips to the existing indexes as expected.
