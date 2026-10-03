# PHASE 15 — Production State Baseline

Every figure below was read directly from the database or the running process. No prior report was
trusted, and one of them turned out to be wrong (section F).

**Measured:** 2026-09-05. **Read-only. No production write was performed.**

---

## A. The environment, stated plainly

| | |
|---|---|
| Database | `homigo_db` on container `homigo-postgres` (5433 -> 5432) |
| Engine | PostgreSQL 16.14 (Alpine) |
| Size | 1001 MB, 203 public tables |
| **Deployed application** | **NONE — no process is listening on any port** |
| Deployment artifacts | `apps/backend/Dockerfile`, `deploy/cloud-run/service.yaml`, `apps/backend/deploy/homigo-backend.service` |
| Code version | `1.0.0`, git `0a86cd2`, branch `cursor/stage-e-step-13-certification` |

**This is the single most important fact in this document.** "Production" here is a database holding
real data. There is no production runtime: nothing serves HTTP, no worker or scheduler process is
running against it, and no traffic exists to observe. Sections of the brief that depend on a
deployed system — canary cohorts, production traffic verification, live route checks — have no
target in this environment.

## B. Production authorization

Searched for an authorization mechanism before touching anything: shell environment, repository
authorization files, and any codebase convention (`PRODUCTION_MIGRATION_AUTHORIZED`,
`ALLOW_PRODUCTION`, `CONFIRM_PRODUCTION`, `--force-production`).

**None exists.** `IS_EXPLICIT_PRODUCTION_AUTHORIZATION_PRESENT = NO`.

Per the brief's own rule, wanting the system live does not authorize a production mutation when the
execution context has no authorization mechanism. Everything below stops at that boundary.

## C. Migration state

```
_prisma_migrations : 100 rows
                      97 applied   (finished_at set, rolled_back_at null)
                       3 rolled back
                       0 unfinished
migrations on disk : 108
                      11 not applied to production
latest applied     : 20260902120000_earning_settlement_status_enum  (2026-09-02)
```

## D. Phase-14 / Phase-15 objects — present or absent

| Object | Production |
|---|---|
| `enterprise_audit_logs` | **PRESENT** — 353,220 rows |
| `enterprise_audit_logs_trace_id_key` | **STILL UNIQUE** — the Phase-14 audit fix is NOT deployed |
| `ai_tool_policy_logs` | PRESENT |
| `ml_model_versions` | **ABSENT** |
| `ai_budget_policies` / `ai_budget_windows` | **ABSENT** |
| `ai_workflow_drafts` | **ABSENT** |
| `support_ai_recommendations` | **ABSENT** |
| `platform_feature_flags` | PRESENT — **2 flags, both `environment='dev'`, both OFF** |
| `workflow_definitions` | PRESENT — 25 total, 14 ACTIVE |
| `workflow_instances` | PRESENT — 102 WAITING, 374 COMPLETED, 1133 SKIPPED |
| `scheduled_jobs` | PRESENT — 4,600 rows, last completed 2026-09-05T16:47 |
| `notification_deliveries` | PRESENT — **0 rows** |
| `bookings_provider_slot_excl` / `bookings_user_slot_excl` | Both still **closed `'[]'`** — the back-to-back booking fix is NOT deployed |

**Feature-flag consequence:** the brief requires every production-facing Phase-15 feature to move
through DRAFT -> SHADOW -> CONTROLLED -> PRODUCTION using the existing flag architecture. Production
holds exactly two flags, both scoped to `dev` and both off. There is no production flag state for
any Phase-15 capability to be rolled out through.

## E. Financial integrity — measured, not assumed

`financialIntegrityService.validate()` against production:

```
score: 84

WALLET_LIABILITY_MISMATCH  HIGH   ops wallet Rs.106,998    vs ledger CUSTOMER_WALLET  Rs.107,998   (gap Rs.1,000)
PROVIDER_PAYABLE_MISMATCH  HIGH   ops provider Rs.121,849.40 vs ledger PROVIDER_PAYABLE Rs.120,866.40 (gap Rs.983)
```

Two open HIGH-severity drifts between operational balances and the ledger. Not introduced by this
work; recorded because a production baseline that omits them is not a baseline.

## F. A prior number this baseline corrects

Earlier reports stated "100 applied / 107 on disk". **100 is the row count of the migration ledger,
not the number applied.** The applied count is **97**; three rows are rolled back.

A second correction, in the other direction: a check against `pg_constraint` reported `trace_id` as
**not** unique, which would have meant the Phase-14 blocker was already resolved. It was the query
that was wrong — the uniqueness is a unique **index**, which `pg_constraint` does not list.
`pg_indexes` confirms `CREATE UNIQUE INDEX ... enterprise_audit_logs_trace_id_key`. The blocker
stands.

Both are recorded because a mis-scoped catalog query is exactly how a live blocker gets reported as
cleared.
