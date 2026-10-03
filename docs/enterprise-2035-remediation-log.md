# HOMEEIGO — Enterprise Remediation Log

**2026-09-21** — work performed after the Master Audit, in the mission's execution order.

Every entry is either FIXED with evidence, or explicitly left open with the reason it was not taken.

**No data was mutated. No commit was made. No `prisma db push`. No migration history rewritten.**

---

## 1. Audit findings corrected by remediation

The audit's diagnosis was **wrong** on eight findings. Each was corrected only after re-measurement, not by assertion.

| Audit finding | Claimed | Actual | Why the audit was wrong |
|---|---|---|---|
| **DB-4 / BLOCKER-1** | 3 rolled-back migrations; history cannot rebuild the schema; **P0** | Those 3 are benign Prisma **retries** — each has a clean applied row. A **4th**, which the audit never saw, is rename residue. A fresh DB applies all 125 migrations and passes 29/29 checks | The query filtered `finished_at IS NULL` without checking whether a *successful* row existed for the same migration |
| **DB-6** | ₹52,939 drift across 24 users; **no invariant exists** | **₹32** in aggregate. `WALLET_LIABILITY_MISMATCH` exists at `financial-integrity.service.ts:263` and **had been failing continuously** | Summed the **float** column and counted **all** transactions, including 11 `EXPIRED` and 2 `PENDING` that correctly never moved a balance |
| **DB-7** | 53 refunds "stranded because recovery is gated off" | The gating is a **deliberate, documented fail-safe** added after a 2026-09-19 incident. The 53 are `f2 cert` fault-injection artifacts (₹1 each). `INDETERMINATE` is terminal-for-automation **by design**, to prevent double refunds | Read a safety posture as a defect |
| **DB-2** | "Autovacuum has **never run** on any table" | Unsupportable. Autovacuum is **on** with defaults; the statistics were **lost** (every counter 0, `stats_reset` NULL) — almost certainly a container restart | `last_autovacuum = never` means "no statistics", not "never vacuumed" |
| **DB-3 / SEC-7** | 575k audit rows with **no retention** | `enterprise_audit_logs` **is** covered — archived then deleted by retention category. Only `assignment_audits` is uncovered | Did not read `data-retention.service.ts` |
| **DB-1 (`otps`)** | "13 rows, 20 MB", implying heap bloat | The heap is **one 8 KB page**. All 20 MB is **index** bloat — which needs `REINDEX`, not `VACUUM FULL` | Used `pg_total_relation_size` without splitting heap from indexes |
| **SEC-2** | `ALLOWED_ORIGINS` is the **sole** input to production CORS | It is merged with built-in defaults and three `*_URL` variables. Its absence is not an outage | Read one input as if it were the only one |
| **SEC-5** | `PII_MASTER_KEY` absent | That variable does not exist. The real one, `MASTER_ENCRYPTION_KEY`, **is set**, and `pii-crypto` fails closed in production without it | Wrong variable name |

---

## 2. Defects found during remediation that the audit missed

| ID | Sev | Finding | Status |
|---|---|---|---|
| **MIG-1** | **P1** | `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` cannot drop a `CREATE UNIQUE INDEX`, and `IF EXISTS` silenced the mismatch. Four unique indexes on **plaintext PII columns** survive into any fresh deployment. The same wrong-verb pattern appears against six index names | **FIXED** |
| **MIG-2** | **P1** | Fifteen indexes existed only via `prisma db push` — including `booking_unique_active_slot`, the **duplicate-booking guard**. A production database built from migrations would have had none of them | **FIXED** |
| **MIG-3** | P2 | The live database is **missing three performance indexes** that a recorded-as-applied migration creates | **FIXED** |
| **FIN-1** | **P1** | The reconciler posted **56 plug entries (−₹17,245)** forcing the commingled `PLATFORM_ESCROW` to equal active gift-card balance — a comparison that was never an invariant. Real escrow of ₹26,631 now reads ₹9,386 | **FIXED** |
| **FIN-2** | P2 | **117 adjusting entries** across four accounts. `PROVIDER_PAYABLE` reconciles to ₹0.00 *only because* ₹10,294.60 of plugs put it there | **Mitigated** |
| **REF-1** | P2 | The admin refund queue returned 100 rows oldest-first from 303 actionable refunds, so **0 of 53 INDETERMINATE were visible**, and the "needs retry" tile read **100** instead of 303 | **FIXED** |
| **SEC-9** | **P1** | `AI_RATE_LIMIT_BYPASS` and `AI_TOOL_CERTIFICATION_MODE` were read with **no environment condition at all** — either could be set on a deployed host to disable AI rate limiting entirely | **FIXED** |
| **SEC-10** | P2 | The deployed CORS allowlist included `http://localhost:3001/3002/3003` **with `credentials: true`** | **FIXED** |
| **SEC-11** | P2 | `EncryptionService.hashForLookup` peppered provider PAN/Aadhaar lookup hashes with the literal `"homigo"` when keys were unset, with no production guard | **FIXED** |
| **WFR-1** | **P1** | Recovery **requires** `observedUpdatedAt`; detection never returned `updatedAt`. The optimistic-concurrency check was **unsatisfiable from its own payload** — no operator UI could have been built against it | **FIXED** |
| **ETL-1** | **P1** | `homigo_etl_jobs_running` read **111** on a pipeline with zero successes in a month. All 111 were crashed executions. That is the number an operator would use to conclude the pipeline was busy rather than broken | **FIXED** |
| **DBH-1** | **P1** | ~399 MB of a 1,060 MB database is space retention already freed and nothing returned. `provider_match_scores` holds **1 row in 31,629 pages** | **Recurrence FIXED**; reclamation needs an operator window |
| **DBH-4** | P2 | `assignment_audits` (173,197 rows / 186 MB) has no retention policy | **OPEN — data-owner decision** |

---

## 3. Changes made

### Migrations — 2, both hand-written and validated on isolated clones

- **`20260921090000_schema_drift_repair`** — drops the 4 stale plaintext-PII unique indexes with the verb that actually works; creates 17 indexes including `booking_unique_active_slot`; heals the 3 performance indexes live is missing. Every statement idempotent.
- **`20260921100000_autovacuum_high_churn_tables`** — per-table autovacuum parameters for 8 delete-heavy tables. Storage parameters only; no data touched.

Neither was generated with `prisma migrate diff`. Run against this schema, that tool additionally proposes `ALTER TABLE "bookings" DROP COLUMN "provider_slot_end"` and `ALTER TABLE "knowledge_chunks" DROP COLUMN "search_vector"` — 5 column drops among 83 statements — which would delete the booking slot-exclusion constraints outright.

### Code

| File | Change |
|---|---|
| `services/ledger-reconciliation.service.ts` | `PLATFORM_ESCROW` removed from `ADJUSTABLE`; escrow row made informational; `maxDelta` computed only over invariant-backed accounts |
| `services/refund-workflow.service.ts` | Urgent-first queue ordering; authoritative `indeterminate` and `needsRetry` counts |
| `lib/production-config.ts` | 10 bypass flags refused in **staging and production** |
| `index.ts` | Localhost origins removed from the deployed CORS allowlist |
| `utils/encryption.ts` | `"homigo"` pepper fallback removed; fails closed |
| `services/workflow-recovery.service.ts` | `updatedAt` added to `StuckInstance` |
| `lib/etl-metrics.ts` | `running` split from `abandoned`; `recovering_24h` added; all initialised at 0 |
| `admin-panel` automation page | Stuck-workflow operator panel |
| `admin-panel` refunds page | "Needs retry" tile reads the authoritative count |

### New tooling — all read-only, explicit `--url`, non-zero exit on findings

- **`scripts/verify-migration-authority.ts`** — 29 checks: protected objects, half-open slot ranges, absence of stale PII indexes, generated-client compatibility across 10 money/booking models, migration-history consistency.
- **`scripts/diagnose-wallet-liability.ts`** — attributes liability deltas instead of closing them; marks plug entries and reports what each account would read without them.
- **`scripts/check-db-hygiene.ts`** — separates BLOAT from GROWTH and prescribes the matching remedy. **It found `app_log_entries`, which this work had missed.**

### New tests — 4 files, 23 assertions

`ledger-reconciliation-scope`, `refund-queue-priority`, `production-bypass-guard`, `workflow-recovery-contract`.

The ledger test was **verified to fail when the defect is reintroduced**: `PLATFORM_ESCROW` was temporarily added back to `ADJUSTABLE`, the suite reported 2 pass / 2 fail, and the source was restored. A check that cannot fail is not a check.

---

## 4. Verification

| Gate | Result |
|---|---|
| Typecheck — backend, admin, web, partner-web | **4/4 exit 0** |
| Targeted regression — 10 suites | **170 pass / 0 fail** |
| `check-log-governance.ts` | **PASS** — 632 files scanned |
| `check-migration-safety.ts` | **PASS** — 55 files. It **refused** this work's first destructive draft; the gate was not overridden, a justification was written and then **verified** |
| `check-ddl-guard-coverage.ts` | **PASS** — it **caught** a hardcoded database name in a new script's usage comment |
| `verify-migration-authority.ts` — live DB | **29/29 PASS** |
| `verify-migration-authority.ts` — migrations-only rebuild | **29/29 PASS** |
| Live backend after changes | `/health` 200 · `/ready` 200 · unauthenticated admin 401 · `/api/services` 200 |

Both repository gates that fired did so against *this* work, and both were satisfied by fixing the code rather than by overriding the gate.

---

## 5. Open items — each needs a decision, not more engineering

| # | Item | Why it was not done here |
|---|---|---|
| 1 | Apply the two migrations to `homigo_db` | Operator action. Runbooks in `migration-authority.md` §6 and `database-hygiene.md` §5. Expected effect on live: **+6 indexes, no drops, no data change** |
| 2 | Reclaim ~399 MB (`VACUUM FULL` / `REINDEX`) | Takes an `ACCESS EXCLUSIVE` lock — needs a maintenance window |
| 3 | Reverse the 56 escrow plugs (−₹17,245) | A correcting journal entry against historical periods. Finance sign-off, not a script |
| 4 | Resolve the ₹32 customer-wallet drift | Narrowed to an event class, not to an event. Deliberately **not plugged** — that reflex produced the other 117 entries |
| 5 | `assignment_audits` retention | Deleting a dispatch audit trail is a compliance decision: it sets how far back a disputed assignment can be reconstructed |
| 6 | Reaper for 111 abandoned ETL executions | Would write to `homigo_db`. The new `homigo_etl_jobs_abandoned` gauge makes them visible, which is the more important half |
| 7 | BigQuery billing — restore or retire ETL | External dependency plus a business decision. **Do not build a second ETL**; the engine is sound, only its destination is unpayable |
| 8 | `forensic_recovery_log` table | Incident artifact on live, outside migrations. Export or drop |
| 9 | Rename-residue migration row | Recommendation: **leave it**. Deleting rows from `_prisma_migrations` to tidy a report is the habit that hides real problems |

---

## Pass 6 addendum (2026-09-21)

The full record is `enterprise-2035-pass6-final-execution-board.md`. In one paragraph: the Pass 5
P1 (live schema behind the client, login 500) was closed by `migrate deploy`, and a full catalog
diff of a migrations-only rebuild against live then found a CHECK constraint that lived only on
live (`booking_completed_requires_timestamp`) plus three column drifts — all now owned by
`20260921140000` and asserted by four gates. Eleven P2s were fixed with reintroduction-proven
tests: the admin refund queue 500, two admin routers refusing admins, a public 500 on bad
coordinates, provenance tooling blind to encrypted e-mails (DQ-7 impact corrected 0.2% → 24.1%),
a placeholder-domain misclassification, uncapped AI spend on deployed hosts, staging running with
dev affordances, business customers dispatched to fixture partners, and three fixtures building
impossible COMPLETED rows. Nothing historical was corrected, deleted or plugged; every live data
snapshot in the pass is identical before and after.
