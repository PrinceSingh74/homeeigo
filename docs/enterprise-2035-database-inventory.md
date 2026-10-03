# HOMEEIGO — Enterprise 2035 Database Inventory

Source of truth: `apps/backend/prisma/schema.prisma` (6,856 lines) and the live `homigo_db` instance queried read-only on 2026-09-21.

---

## 1. Shape

| Metric | Value |
|---|---|
| Prisma models | **218** |
| Prisma enums | **150** |
| Physical tables (`public`) | **220** |
| Indexes | **937** |
| Foreign keys | **171** |
| CHECK constraints | **1,838** |
| Triggers | **34** |
| Migrations recorded | **125** |
| Migrations applied cleanly | **122** |
| Migrations failed + rolled back | **3** |
| Database size | **1,060 MB** |

1,838 CHECK constraints against 220 tables is unusually strong — invariants are enforced in the database, not only in application code. 171 FKs and 34 triggers likewise indicate the schema does real work.

---

## 2. Model usage analysis

Method: counted Prisma client call-sites (`.model.findMany(` etc.) across `apps/backend/src`, `apps/backend/analytics` and `apps/backend/scripts`, separating production code from tests and scripts, then cross-checked raw-SQL table references and live row counts.

> **Correction recorded during the audit:** an initial pass scanned only `src/` and wrongly flagged six tables as orphans. `apps/backend/analytics/` (18 files) sits **outside** `src/` and is loaded by `src/lib/maintenance.ts`. Re-running with `analytics/` included reduced the candidate set from 6 to 4. The figures below are the corrected ones.

### 2.1 Models with zero production Prisma calls (9 of 218)

| Model | Table | Real access path | Verdict |
|---|---|---|---|
| `ServiceVariant` | `service_variants` | `$queryRaw`/`$executeRaw` in `src/lib/service-catalog-store.ts` | **ACTIVE** (raw SQL) |
| `ServiceAddon` | `service_addons` | same | **ACTIVE** (raw SQL) |
| `DocumentSequence` | `document_sequences` | `src/lib/booking-number.ts` atomic upsert | **ACTIVE** (raw SQL) |
| `OpsAlertAcknowledgement` | `ops_alert_acknowledgements` | `src/services/ops-alert-ack.service.ts` | **ACTIVE** (raw SQL) |
| `ServiceCategory` | `service_categories` | none in runtime code (5 rows present) | **DATA-ONLY, no reader** |
| `CouponSegment` | `coupon_segments` | none (0 rows) | **ORPHAN** |
| `CouponCampaign` | `coupon_campaigns` | none (0 rows) | **ORPHAN** |
| `CouponRule` | `coupon_rules` | none (1 stale row) | **ORPHAN** |
| `AiGatewayUsage` | `ai_gateway_usage` | none (0 rows) | **ORPHAN — superseded** |

Four genuine orphans. `AiGatewayUsage` is the notable one: AI budget enforcement really happens, but through `AiBudgetPolicy` / `AiBudgetWindow`. This table is abandoned earlier-design schema.

The `service_categories` case is different and worth calling out: the table holds 5 rows but **nothing in the runtime reads it**. Category resolution goes through `Service.category` plus the JSONB catalogue taxonomy. It is schema + data with no consumer.

### 2.2 Most-used models (production call-sites)

| Model | prod | test | script |
|---|---|---|---|
| `Booking` | 250 | 198 | 205 |
| `Provider` | 183 | 105 | 134 |
| `User` | 146 | 159 | 240 |
| `Payment` | 101 | 65 | 65 |
| `PartnerLead` | 63 | 7 | 2 |
| `WalletTransaction` | 51 | 66 | 54 |
| `Service` | 50 | 23 | 74 |
| `Withdrawal` | 46 | 13 | 10 |
| `PartnerReferral` | 45 | 8 | 10 |
| `AssignmentAttempt` | 43 | 35 | 36 |
| `SupportTicket` | 40 | 11 | 13 |
| `RefundRequest` | 40 | 11 | 20 |
| `AssignmentJob` | 38 | 31 | 33 |
| `Rating` | 37 | 13 | 5 |
| `UserSubscription` | 36 | 1 | 11 |

`UserSubscription` at 36 production call-sites with **1** test call-site is the weakest test-to-use ratio among the money-adjacent models — membership/subscription logic is comparatively under-tested.

---

## 3. Physical size and hygiene — P1 PROBLEM

Largest objects, with exact row counts and vacuum state:

| Table | Exact rows | Total size | last_vacuum | last_autovacuum |
|---|---|---|---|---|
| `provider_match_scores` | **1** | **329 MB** | never | **never** |
| `enterprise_audit_logs` | 401,690 | 260 MB | never | **never** |
| `assignment_audits` | 173,197 | 186 MB | never | **never** |
| `app_log_entries` | 2,642 | 50 MB | — | — |
| `activity_logs` | 100,771 | 48 MB | — | — |
| `refresh_tokens` | 14,593 | 26 MB | never | **never** |
| `otps` | **13** | **20 MB** | never | **never** |
| `ai_tool_executions` | 13,146 | 12 MB | — | — |
| `ai_activity_timeline` | 14,661 | 11 MB | — | — |
| `event_consumer_receipts` | 18,713 | 11 MB | — | — |
| `financial_integrity_runs` | 15,560 | 8.2 MB | — | — |
| `etl_job_executions` | 7,506 | 6.2 MB | — | — |

### DB-1 (P1, DATABASE) — catastrophic bloat from unreclaimed deletes

`provider_match_scores` is the **largest object in the database and contains one row**. Retention deletion ran (`MATCH_SCORE_RETENTION_DAYS`); the space was never reclaimed. `otps` shows the same signature: 13 rows, 20 MB.

**Impact:** ~350 MB of the 1,060 MB database — roughly a third — is dead space. Sequential scans, backup size and restore time all pay for it.

**Action:** `VACUUM (FULL, ANALYZE) provider_match_scores; VACUUM (FULL, ANALYZE) otps;` during a maintenance window (takes an ACCESS EXCLUSIVE lock), then fix DB-2.

### DB-2 (P1, DATABASE) — autovacuum is not running

Every table inspected reports `last_vacuum = never` **and** `last_autovacuum = never`. For a 1 GB database with tables taking 400k inserts, this is not a tuning nit — it is the cause of DB-1 and it will recur.

**Action:** confirm `autovacuum = on`, then set per-table thresholds on the high-churn tables (`enterprise_audit_logs`, `assignment_audits`, `activity_logs`, `event_consumer_receipts`, `refresh_tokens`).

### DB-3 (P1, DATA) — unbounded audit growth with no retention

`enterprise_audit_logs` (401,690 rows / 260 MB) and `assignment_audits` (173,197 / 186 MB) have no retention policy applied. Together they are 42 % of the database. Project memory records a prior 699 MB `app_log_entries` explosion that produced a three-barrier log-governance platform; **that governance was applied to application logs, not to these audit tables.**

**Action:** extend the existing retention scheduler (`src/lib/retention-scheduler.ts`, `APP_LOG_RETENTION_DAYS`) to cover audit tables, with archive-before-delete for anything with a compliance retention requirement.

---

## 4. Migration integrity — P1

3 of 125 migrations are recorded failed and rolled back:

| Migration | Started | Rolled back |
|---|---|---|
| `20260816120000_automation_workflow_engine` | 2026-08-19 | 2026-08-19 |
| `20260817100000_notification_platform` | 2026-08-19 | 2026-08-19 |
| `20260825140000_audit_log_action_created_at_index` | 2026-08-25 | 2026-08-29 |

The objects exist and work (workflows and notifications both run live), so the DDL reached the database by another route.

### DB-4 (P1, DATABASE) — `_prisma_migrations` no longer describes the schema

A fresh environment replaying this history would not reproduce the current database. This is the single largest obstacle to standing up staging or production from migrations.

**Action:** generate a verified baseline from the live schema, reconcile the three entries, and add a CI job that applies migrations to an empty database and diffs the result against `schema.prisma`. A `migrations-only` rehearsal already exists in the test suite per project memory — promote it to a required check.

**Positive:** the repository's own safety gates are good. `prebuild` runs `check-migration-safety.ts` and `check-ddl-guard-coverage.ts`; CI runs both plus their tests. A scan of all 125 migration files found **zero** `DROP TABLE` / `DROP COLUMN` / `TRUNCATE`, and **no** migration directory contains more than one `.sql` file (the silently-ignored-second-file hazard recorded in project memory is not present).

---

## 5. Money schema

`ledger_entries`:

```
id text, journal_id text, account_id text,
debit double precision, credit double precision,      <- float
currency text, created_at timestamp,
debit_paise bigint, credit_paise bigint               <- authoritative integers
```

Integer paise columns exist and are populated (0 NULLs across 2,295 rows). The `double precision` columns are retained alongside and currently agree exactly.

### DB-5 (P2, DATA) — float money columns retained next to integer truth

Both representations currently balance to zero, so there is no live discrepancy. The risk is future drift: any write path that updates only the float pair reintroduces rounding error into a system that has otherwise eliminated it.

**Action:** make the float columns generated/read-only or drop them once all readers are confirmed on `*_paise`; add an invariant test asserting the two representations agree.

**Verified invariants (live):**

| Check | Result |
|---|---|
| Global `SUM(debit_paise) − SUM(credit_paise)` | **0** |
| Global float equivalent | **0** |
| Unbalanced journals (of 975) | **0** |
| NULL paise rows | **0** |
| Payments with no parent booking | **0** |

---

## 6. Data-integrity findings

### DB-6 (P1, DATA) — wallet balances do not reconcile

24 users where `users.wallet_balance ≠ Σ wallet_transactions`, total drift **₹52,939**. 11 of them (₹46,589) have **zero** wallet transactions. Only 2 of 24 have obviously synthetic e-mail addresses.

The ledger itself is perfectly balanced, so this is a *balance-column* problem, not a double-entry problem — consistent with directly-seeded fixture balances. But there is **no automated invariant asserting this equality**, which is why it went unnoticed.

**Action:** add `wallet_balance == Σ wallet_transactions` to the financial-integrity run (`financial_integrity_runs` already has 15,560 rows, so the harness exists); reconcile or quarantine the 24 rows.

### DB-7 (P2, DATA) — 53 payments stranded in `REFUNDING`

Exactly matches 53 `refund_requests` in `INDETERMINATE`, aged 16–35 days. `REFUND_AUTO_RECOVERY_ENABLED` is absent from `.env`, so the resolving sweep is gated off. Also 250 `FAILED` refund requests at max retry 5.

### DB-8 (P3, DATA) — 18 completed bookings with no earning row

255 `COMPLETED` bookings; 18 have no `earnings` record. Partner compensation for those jobs is unaccounted.

### DB-9 (P3, DATA) — ETL zombie rows

111 `etl_job_executions` stuck in `RUNNING` since ≤ 2026-09-04; 3,148 `RECOVERING` and 1,539 `FAILED` still accumulating daily. No terminal-state reaper.

---

## 7. Table → consumer map (principal tables)

| Table | Backend module | API | Customer | Partner | Admin | Jobs |
|---|---|---|---|---|---|---|
| `bookings` | `booking.service` + 16 siblings | `/api/bookings/*`, `/api/users/bookings` | ✅ | ✅ | ✅ | assignment, integrity, archival |
| `payments` | `payment.service`, `razorpay.service` | `/api/payments/*`, `/api/webhooks` | ✅ | — | ✅ | reconcile, settlement |
| `ledger_entries` / `journal_entries` | ledger services | `/api/admin/finance/*` | — | — | ✅ | integrity, snapshot |
| `wallet_transactions` | `wallet.service` | `/api/wallet/*` | ✅ | ✅ | ✅ | reconcile |
| `providers` | `provider.service` | `/api/providers/*` | ✅ (browse) | ✅ | ✅ | score refresh, compliance |
| `assignment_jobs` / `_attempts` / `_audits` | `assignment-engine.service` | `/api/bookings/:id/accept|reject` | — | ✅ | ✅ | 30 s dispatch tick |
| `event_outbox` / `event_consumer_receipts` | `events/core/*` | `/api/admin/automation/*` | — | — | ✅ | outbox + consumers |
| `workflow_instances` / `_step_runs` | `automation/*` | `/api/admin/governance/workflows/*` | — | — | partial | scheduler |
| `etl_job_executions` | `analytics/etl/*` | `/api/analytics/*` | — | — | **unwired** | ETL scheduler (**failing**) |
| `knowledge_documents` / `_chunks` | `knowledge-*.service` | `/api/knowledge/*` (**unwired**) | — | — | `/api/admin/knowledge/ask` | — |
| `provider_match_scores` | `matching.service` (writes) | — | — | — | — | retention (**bloated**) |
| `coupon_campaigns` / `_segments` / `_rules` | **none** | — | — | — | — | — |
| `ai_gateway_usage` | **none** | — | — | — | — | — |
| `service_categories` | **none** | — | — | — | — | — |

---

## 8. Priority summary

| ID | Severity | Class | Finding |
|---|---|---|---|
| DB-1 | **P1** | DATABASE | 329 MB table holding 1 row; ~⅓ of DB is dead space |
| DB-2 | **P1** | DATABASE | Autovacuum has never run on any inspected table |
| DB-3 | **P1** | DATA | 575k audit rows / 446 MB with no retention |
| DB-4 | **P1** | DATABASE | 3 rolled-back migrations; history ≠ schema |
| DB-6 | **P1** | DATA | ₹52,939 wallet drift across 24 users, no invariant guarding it |
| DB-5 | P2 | DATA | Float money columns retained beside integer paise |
| DB-7 | P2 | DATA | 53 payments stranded in `REFUNDING` (recovery gated off) |
| DB-8 | P3 | DATA | 18 completed bookings without earnings |
| DB-9 | P3 | DATA | 111 zombie ETL executions, no reaper |
| DB-10 | P3 | DATABASE | 4 orphan tables (`coupon_*` ×3, `ai_gateway_usage`) + `service_categories` unread |
