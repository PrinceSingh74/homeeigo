# Schema parity: migrations vs test DB vs dev homigo_db (2026-09-20)

**Why this exists.** The Phase 24 clean-environment run (`test:setup --reset`, then the full suite)
failed 64 tests, while the long-lived test DB passed 2554/0. The cause was not the application. The
test DB is built by `db push` plus a replay of selected migration SQL, and that replay was wrong. This
report records what was found. It also records the stronger check that followed: building a database
**only from the migrations**, the way production would be built, and running the whole suite on it.

## 1. Test-DB build defects (FIXED — `scripts/setup-test-db.ts`)
| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | The statement allowlist regexes are anchored (`^CREATE SEQUENCE…`), and a statement preceded by the migration's header comment never matched. | 8 migrations' sequences and unique indexes were silently skipped on every fresh build (CI included). One of them was `wallet_txn_number_seq`, so 61 money suites failed with 42P01. | Strip leading `--` lines before matching. 32 → 39 migrations applied. |
| 2 | Only CREATE statements are replayed; later `DROP INDEX` statements were ignored. | Once #1 was fixed, `assignment_attempts_one_sent_per_job` (created in 20260612, dropped in 20260616 and 20260824) was resurrected, and broadcast-dispatch tests failed. | Pre-scan all migrations for each index's final state; skip a CREATE whose final state is DROP. |
| 3 | The ③a comment claimed wallet/withdrawal numbers come from application code. | Only `journal_entry_number_seq` was ensured. | Ensure all three sequences, fail hard. The final probe calls `nextval` on each. |
| 4 | `document_sequences_value_positive` is declared inside `CREATE TABLE IF NOT EXISTS`. | The CHECK is a no-op after `db push`, so it was absent. | Added idempotently. |
| 5 | The setup printed ✅ with objects missing. | Silent drift. | Setup now runs `check-schema-drift.ts` and exits 1 on any drift. |

`check-schema-drift.ts` now also checks **every Prisma scalar/enum field** (2,915 fields): the column
must exist and, for enums, have the enum type (honouring enum `@@map`).

## 2. Production-shape rehearsal (migrations only)
- An empty database with `prisma migrate deploy` from an isolated copy of `prisma/` (no dotenv): **all
  120 migrations apply** (121 with the fix below).
- Full backend suite on that database (`homigo_mtest`): **2553 pass / 4 fail** before test fixes.
  - `chargebacks.risk_level` was created as TEXT (20260608220000) while the model declares
    `FinancialRiskLevel`. Any Prisma filter on it throws 42883 on a production-built DB. **FIXED:**
    migration `20260920100000_chargeback_risk_level_enum` (guarded, no-op where the type is already
    right). Probe: filter FAIL → OK.
  - `incentive-batch-evaluation` "no active rules" assumed an empty rule table, but a migrations-built
    DB always has the rules seeded by 20260708120000. **Test fixed** (deactivate, then restore).
  - `scheduling-contract` #10 expected 23P01. The unique index `bookings_provider_scheduled_active_key`
    (present in production and dev) answers 23505 first for an identical start. The old test DB lacked
    that index, so the assertion only ever passed on a weaker schema. **Test fixed** (overlapping,
    non-identical start).
  - `maintenance-target-guard` ×2 hard-code the DB name `homigo_test`. This is a harness artifact of a
    differently named DB, not a schema issue.

## 3. Dev `homigo_db` vs migrations — OWNER ACTION (not changed: homigo_db is read-only for this work)
| Finding | Consequence | Recommended action |
|---|---|---|
| `20260916110000_refund_retry_scheduling` **never applied**. `refund_requests.retry_count`/`next_retry_at` are missing. | **Every full `RefundRequest` read on dev throws P2022** (proven read-only). Dev refund screens and flows are broken. | Back up, then `migrate deploy` against dev. |
| 9 more migrations were hand-applied (objects present, drift OK) but are not recorded in `_prisma_migrations`: 20260907170000, 20260916090000, 20260916100000, 20260919090000/100000/110000/120000/130000, 20260920090000. | `migrate deploy` would try to re-run them. | `prisma migrate resolve --applied <name>` for each, **after** verifying objects (drift check), then deploy. |
| `_prisma_migrations` records `20260817090000_notification_delivery_claim`, which has no directory in the repo. | `migrate status` reports an unknown applied migration. | Find its origin (git history). Restore the directory or document it. |
| Dev-only objects created by ad-hoc SQL, not migrations: CHECK `booking_completed_requires_timestamp`, unique `booking_unique_active_slot` (`scripts/sql/booking-uniqueness.sql`), `sync_money_sim_paise()` (money simulation), ~14 FK indexes. | Production (migrations) will **not** have them. Dev behaviour differs from production. | Decide per object. The CHECK and FK indexes are good candidates for a hand-scoped migration (verify existing data first). The simulation function should be dropped from dev. |
| Migrations create unique indexes on `users.email`, `users.phone_number`, `providers.aadhar_number`, `providers.pan_number`; dev has dropped them. | A behaviour difference on PII columns. | Confirm the intended state with the PII-encryption owner, then encode it in a migration. |
| `geofences.service_categories` is nullable in migrations and NOT NULL on dev. | Minor. | Align in the next hand-scoped migration. |

**Owner:** platform/database engineering. Nothing in §3 was executed.
