# HOMIGO Database Optimization Report

**Date:** 2026-06-18 · **Source:** live `pg_stat_statements` (installed + tracking, 157+ statements) + `pg_stat_user_indexes`/`pg_stat_user_tables`. Every row below is real captured data, not estimated.

## Heavy queries — top by total exec time
| Calls | Total ms | Mean ms | Query (truncated) |
|------:|---------:|--------:|-------------------|
| 5,744 | 9,657 | 1.68 | `INSERT INTO app_log_entries …` |
| 5,686 | 4,939 | 0.87 | `SELECT … FROM bookings …` |
| 5,686 | 1,495 | 0.26 | `SELECT … FROM providers …` |
| 5,686 | 1,482 | 0.26 | `SELECT … FROM users …` |
| 163 | 511 | 3.13 | `SELECT pg_database_size(...)` ← FinOps sampler |

## Slow queries — top by mean time
| Mean ms | Calls | Query |
|--------:|------:|-------|
| 11.20 | 11 | `INSERT INTO refresh_tokens …` |
| 8.81 | 9 | `SELECT COUNT(*) FROM app_log_entries …` |
| 5.84 | 3 | `UPDATE geofences SET surge_multiplier …` |
| 4.94 | 11 | `INSERT INTO enterprise_audit_logs …` |

## Query frequency — top by call count (per-request hot path)
`app_log_entries INSERT` (5,744), `user_auth_epochs SELECT` (5,727), `providers` / `token_blacklist` / `users` (5,705 each). These fire on **every authenticated request** (auth middleware).

## Potential N+1 / per-request overhead
The auth path issues **4 separate point-lookups per request** (`user_auth_epochs`, `token_blacklist`, `users`, providers). High call counts, sub-ms each, but they dominate DB QPS at scale.

## Unused indexes (idx_scan = 0 — drop candidates)
| Index | Size |
|-------|------|
| `app_log_entries.trace_id_idx` | **67 MB** |
| `app_log_entries.request_id_idx` | **46 MB** |
| `app_log_entries.level_idx` / `payment_id_idx` / `booking_id_idx` | ~8.6 MB each |

≈ **~140 MB reclaimable** — these were created but never scanned (log-table indexes rarely queried).

## Sequential-scan heavy tables (missing-index candidates at scale)
| Table | seq_scan | idx_scan | live rows |
|-------|---------:|---------:|----------:|
| providers | 35,880 | 0 | ~0 |
| services | 13,219 | 2 | ~0 |
| assignment_jobs | 9,637 | 0 | ~0 |
| bookings | 8,568 | 4,004 | ~0 |

> At current (near-empty seeded) volume Postgres correctly prefers seq scans; flagged for **re-check at scale** — not a problem today.

## Recommendations (prioritised, with proof basis)
1. **Drop the unused `app_log_entries` indexes** (`trace_id`, `request_id`, `level`, `payment_id`, `booking_id`) → reclaim ~140 MB, cut INSERT write-amplification on the #1 heavy query. *(idx_scan=0 over the DB lifetime — safe; re-verify after a week of prod traffic first.)*
2. **Cache the per-request auth lookups** (`user_auth_epochs`, `token_blacklist`) in Redis with short TTL → removes 2 of the top-5 most-frequent queries from the DB hot path. Biggest QPS win at scale.
3. **Batch/async `app_log_entries` writes** — the #1 heavy query by total time. Buffer + bulk-insert (or move to a logging queue worker) to cut per-request write cost.
4. **FinOps sampler:** `pg_database_size` runs every scrape (3.13 ms × 163). Cache the value 60 s in the sampler to remove self-inflicted load. *(Minor.)*
5. **At scale (50k+):** add covering indexes on `providers`/`assignment_jobs` filter columns once tables grow (seq_scan-heavy today only because tables are tiny).

## Verdict
`pg_stat_statements` is **installed and capturing real telemetry** (closes prior audit gap G3). The DB has **no slow queries > 50 ms** under current load (`pg_slow_queries=0`, slowest mean 11.2 ms). The optimizations above are scale-readiness, not current defects.
