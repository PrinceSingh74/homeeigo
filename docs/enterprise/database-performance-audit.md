# HOMIGO Database Performance Audit (PHASE 3)

**Date:** 2026-06-18 · **DB:** PostgreSQL 16 (`homigo_db`) · **Method:** live `psql` against the running database (`pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_constraint`, `pg_indexes`). Every number executed.

## Overview (real)
| Metric | Value |
|--------|-------|
| Tables | **120** |
| Total size | **1324 MB** |
| Indexes | **527** |
| Foreign keys | **116** |

## 🔴 Finding 1 — one log table is 94% of the database
| Table | Total size | Live rows |
|-------|-----------|-----------|
| **app_log_entries** | **1241 MB** | 18,867 |
| enterprise_audit_logs | 29 MB | 594 |
| provider_match_scores | 21 MB | 1,920 |
| *(all other 117 tables)* | ~33 MB | — |

`app_log_entries` holds the app-level structured logs (large JSONB `metadata` → heavy TOAST).
`n_dead_tup = 0` so this is **not VACUUM bloat** — it is genuine log volume + index weight.
Its `trace_id_idx` (**132 MB**) and `request_id_idx` (**91 MB**) show **idx_scan = 0**.

**Action (proven-safe):** add a **retention/archival policy** (e.g. drop logs > 30–90d to
cold storage; the table already has `created_at`). Re-evaluate the trace/request indexes
against production query patterns before dropping (see caveat below). Potential reclaim ≈ **1.2 GB**.

## 🟠 Finding 2 — 13 foreign keys lack a covering index
Unindexed FKs cause slow joins and slow `ON DELETE` cascades at scale. Executed FK-vs-index check found:

```
activity_logs.booking_id        bookings.service_id        bookings.address_id
compliance_request_audits.actor_id   coupon_usages.booking_id   fraud_alerts.referral_transaction_id
fraud_alerts.commission_id      gift_card_redemption_attempts.gift_card_id   otps.user_id
payment_settlements.settlement_batch_id   refresh_tokens.parent_token_id
support_tickets.booking_id      user_subscriptions.plan_id
```

**Action (additive, safe):** add covering B-tree indexes on these FK columns. `bookings.service_id`,
`bookings.address_id`, `coupon_usages.booking_id`, `support_tickets.booking_id`,
`user_subscriptions.plan_id` are the highest-value (hot join paths). Additive indexes carry no
correctness risk — recommended before high-volume production.

## 🟡 Finding 3 — "unused indexes" — HONEST caveat (no drops performed)
`idx_scan = 0` was observed on ~25 indexes (223 MB of it on `app_log_entries` alone).
**`pg_stat_database.stats_reset` is NULL** (stats span the DB lifetime) — but that lifetime is
**synthetic seed data + load-test traffic with low query diversity**, not production. Per mission
rule *"every removal requires proof,"* `idx_scan=0` here is **suggestive, not sufficient**.
**No index was dropped.** Recommendation: re-measure `idx_scan` after ≥1 week of real production
traffic, then drop confirmed-dead indexes.

## 🟢 Finding 4 — high seq-scans are NOT a problem at current scale
`providers` (36,433 seq), `services` (17,096), `user_auth_epochs` (17,836), `bookings` (16,856)
show high `seq_scan`. **But `n_live_tup ≈ 0`** (tiny seeded tables) — Postgres correctly prefers
sequential scans on small tables. This metric only becomes meaningful at volume; flagged for
re-check at scale, **not** an issue today.

## ⚪ Finding 5 — autovacuum
`last_autovacuum` / `last_vacuum` are NULL on the large tables. With `n_dead_tup=0` there's no
current bloat, but confirm autovacuum is enabled and tuned for `app_log_entries`' insert rate
before production.

## N+1 / pagination
- Phase 1 observed `provider /me/bookings` = **18 KB** and `admin /ops-map` = **21 KB** responses
  — confirm server-side pagination + eager-load (`include`) rather than per-row queries. **Not
  exhaustively profiled this pass** (query-count instrumentation recommended) — marked PARTIAL.

## Verdict
**PARTIAL — strong real findings, no destructive change made.**
- Actionable now: app_log_entries retention (−1.2 GB), 13 FK covering indexes.
- Deferred honestly: unused-index drops (need production traffic), N+1 profiling.
- No locks/leaks observed; schema integrity intact (116 FKs, 527 indexes).
