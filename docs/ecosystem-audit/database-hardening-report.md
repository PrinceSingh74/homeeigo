# Database Hardening Report — Phase 3

**Date:** 2026-06-10  
**Migration:** `20260610120000_enterprise_db_hardening`

---

## Applied Changes

### CHECK constraints (live)

| Constraint | Table | Rule |
|------------|-------|------|
| `users_wallet_balance_paise_non_negative` | users | `wallet_balance_paise >= 0` |
| `providers_wallet_balance_paise_non_negative` | providers | `wallet_balance_paise >= 0` |
| `providers_reserved_balance_paise_non_negative` | providers | `reserved_balance_paise >= 0` |
| `payments_amount_paise_positive` | payments | `amount_paise > 0` |
| `ratings_score_range` | ratings | `rating BETWEEN 1 AND 5` |

**Deploy evidence:** `prisma migrate deploy` — migration applied successfully.

### Composite indexes added

- `idx_bookings_provider_scheduled` — `(provider_id, scheduled_date DESC)`
- `idx_bookings_user_scheduled` — `(user_id, scheduled_date DESC)`
- `idx_bookings_status_created` — `(status, created_at DESC)`
- `idx_payments_user_status_created` — `(user_id, status, created_at DESC)`
- `idx_users_wallet_balance_paise_positive` — partial index on positive balances

### Pre-existing (verified)

- `wallet_transactions.reference_id` — indexed ✅
- `hcoin_transactions.reference_id` — indexed ✅
- Booking GIST exclusion constraints — 2 live ✅
- **506 total indexes**, **113 FKs**

---

## Rollback SQL

```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_wallet_balance_paise_non_negative;
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_wallet_balance_paise_non_negative;
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_reserved_balance_paise_non_negative;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_paise_positive;
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_score_range;
DROP INDEX IF EXISTS idx_bookings_provider_scheduled;
DROP INDEX IF EXISTS idx_bookings_user_scheduled;
DROP INDEX IF EXISTS idx_bookings_status_created;
DROP INDEX IF EXISTS idx_payments_user_status_created;
DROP INDEX IF EXISTS idx_users_wallet_balance_paise_positive;
```

---

## Performance

| Metric | Value |
|--------|-------|
| `pg_stat_statements` slow query analysis | Not run (extension not confirmed) |
| EXPLAIN ANALYZE on reference_id | Not run this session |
| Load test health P95 | **353ms** @ 100 VU |
| Load test ready P95 | **296ms** @ 100 VU |

---

## Bottleneck

`app_log_entries` — **1.2 GB** / 2.1M rows. Retention policy execution required before scale.

---

## Phase 3 Verdict

**PASS** constraints + indexes applied  
**PARTIAL** EXPLAIN/load proof on authenticated hot paths
