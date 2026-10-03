# HOMEEIGO — Enterprise 2035 Roadmap

Dependency-ordered. Every item states why, what it depends on, effort class, risk, and an acceptance criterion that can be checked.

**Effort classes:** S ≤ 1 day · M ≤ 1 week · L ≤ 1 month · XL > 1 month

**The organising insight:** HOMEEIGO does not need to build much. It needs to *connect, verify and operationalise* what it already built. Roughly 88 finished endpoints have no user interface, and the single largest engineering risk is that the database schema cannot be reproduced from its own migration history.

**No greenfield rewrite is recommended.** No subsystem was found fundamentally unfit.

---

## PHASE 0 — Repository truth (do first, cheap, unblocks judgement)

| # | Action | Why | Effort | Acceptance |
|---|---|---|---|---|
| 0.1 | Archive 60+ root certification reports to `docs/archive/<date>/` | A dozen documents claim final production certification and contradict each other | S | Root holds only `README`, `CONTRIBUTING`, and current docs |
| 0.2 | `.gitignore` logs, `dist-e2e/`, `dist-s05-cert/`, `.step8-tmp/`, `.sixth/`, `scratch-p39/`, `tmp-*`; delete `Code.exe`, `.taskkill`, `tmp-exec-report.pdf` | Multi-GB of logs; 1,699 changed paths make signal indistinguishable from debris | S | `git status` under 50 paths |
| 0.3 | Commit or reset the working tree | An audit cannot separate intent from debris at 1,699 paths | S | Clean tree on a named branch |
| 0.4 | Adopt these 14 documents as the current record | Replaces the contradictory corpus | S | Linked from README |

---

## PHASE 1 — Stability & schema reproducibility (**blocks everything downstream**)

| # | Action | Why | Depends | Effort | Risk | Acceptance |
|---|---|---|---|---|---|---|
| 1.1 | **Reconcile the 3 rolled-back migrations; produce a verified baseline** | `_prisma_migrations` no longer describes the schema — a fresh DB cannot be built (DB-4) | — | M | **High** — touches migration history | Empty DB + `migrate deploy` diffs clean against `schema.prisma` |
| 1.2 | CI job: migrations → empty DB → diff vs schema | Prevents recurrence | 1.1 | S | Low | Required check, fails on drift |
| 1.3 | `VACUUM (FULL, ANALYZE)` `provider_match_scores`, `otps` | 329 MB table holding 1 row; ~⅓ of DB is dead space (DB-1) | — | S | Medium — ACCESS EXCLUSIVE lock | `provider_match_scores` < 1 MB |
| 1.4 | Fix autovacuum; per-table thresholds on churn tables | `last_autovacuum = never` on every table inspected (DB-2) | — | S | Low | `pg_stat_user_tables` shows recent autovacuums |
| 1.5 | Retention for `enterprise_audit_logs` (401k) + `assignment_audits` (173k) + `event_consumer_receipts` | 446 MB, unbounded, PII-bearing (DB-3, SEC-7) | 1.4 | M | Medium — archive before delete | Growth bounded; documented retention per table |
| 1.6 | Reaper for 111 zombie `etl_job_executions` | Permanently-wrong gauge (DB-9) | — | S | Low | `homigo_etl_jobs_running` reflects reality |

**Do not use `prisma migrate diff`** for any of this — project memory records that auto-generated diffs drop booking slot-exclusion columns and 11 indexes. Hand-scope every migration.

---

## PHASE 2 — Security & environment

| # | Action | Why | Depends | Effort | Acceptance |
|---|---|---|---|---|---|
| 2.1 | Hard-fail boot on `LOAD_TEST_MODE` / `HOMIGO_ALLOW_PAYMENT_MOCKS` when `APP_ENV != dev` | Both active today; the first disables rate limiting entirely (SEC-3) | — | S | Boot refuses; test proves it |
| 2.2 | Secret Manager for all non-local credentials; rotate Twilio | Real credentials in plaintext `.env`; two prior leak incidents (SEC-4) | — | M | No secret in any env file; rotation documented |
| 2.3 | Require `ALLOWED_ORIGINS` + `PII_MASTER_KEY` in `assertProductionConfig()`; add both to `.env.example` | Sole input to production CORS is undocumented; silent PII key derivation caused a prior incident (SEC-2, SEC-5) | — | S | Production boot fails without them |
| 2.4 | Reconcile `.env.example` with the 212 vars source reads; delete the 33 phantoms | 120 undocumented, 33 non-existent (CFG-1) | — | M | Counts match; CI asserts it |
| 2.5 | CI test: every admin route has an RBAC rule | 199 rules vs ~262 admin handlers; gaps fail safe but invisibly (SEC-1) | — | S | Enumeration test passes |
| 2.6 | Set `TRUST_PROXY` for deployed environments | Client IP for rate limiting is otherwise the load balancer's (SEC-8) | 2.4 | S | Rate limit keys on real client IP |

---

## PHASE 3 — Data integrity

| # | Action | Why | Effort | Acceptance |
|---|---|---|---|---|
| 3.1 | **Add `users.wallet_balance == Σ wallet_transactions` to the financial-integrity run** | ₹52,939 drift across 24 users went unnoticed because nothing asserts it (DB-6) | S | Invariant runs hourly; violations alert |
| 3.2 | Reconcile or quarantine the 24 drifting users | 11 have zero transactions | M | Drift = 0 or documented exceptions |
| 3.3 | Enable `REFUND_AUTO_RECOVERY_ENABLED`; drain 53 stranded `REFUNDING` payments | Stranded 16–35 days (DB-7) | M | 0 payments `REFUNDING` > 48 h |
| 3.4 | Investigate 250 `FAILED` refund requests at max retry | Terminal failures with no operator path | M | Each classified; a remediation path exists |
| 3.5 | Backfill 18 completed bookings with no earning row | Partner compensation unaccounted (DB-8) | S | 0 completed bookings without earnings |
| 3.6 | Make `ledger_entries.debit/credit` (float) read-only or drop | Float money beside integer truth (DB-5) | M | Single authoritative representation |
| 3.7 | Clean, reproducible seed dataset; stop using `homigo_db` as the integrity reference | 34 % fixture contamination | M | Seed script produces a known-good DB |

---

## PHASE 4 — Connect what is already built (**highest value per unit effort**)

This phase creates almost no new backend capability. It makes ~88 finished endpoints reachable.

| # | Action | Why | Effort | Acceptance |
|---|---|---|---|---|
| 4.1 | **Operator remediation surfaces**: `workflows/stuck` + `/recover`, settlement `investigate`/`notes`, `fraud/decisions`, `commissions/*/unfreeze`, `workflow-drafts` review | The platform detects problems and offers no way to act (OPS-1). 16 stuck workflows are counted and unactionable today | M | Every detector has a remediation control |
| 4.2 | **Customer Intelligence in the customer app**: `/customer-intel/me`, `/recommendations`, `/rebooking`, `/maintenance`, `/recommendation-click` | Backend built; only admins can see it (UNW-1). Clearest revenue-adjacent gap | M | Recommendations render; click-through recorded |
| 4.3 | **Partner self-service**: `lifecycle/pause`, `lifecycle/resume`, `lifecycle/history`, `me/withdrawals` | A partner cannot pause their own availability (UNW-2) | S | Partner can pause/resume and list withdrawals |
| 4.4 | **Resolve duplicate partner-intelligence backends** — retire `me/intel/*` or migrate `*-hq` pages onto it | Two backends answer the same question; one has no caller | M | One family remains |
| 4.5 | **AI budget UI** for `GET/PUT /admin/governance/ai-budgets` | Spend cannot be capped before enabling a real provider | S | A cap can be set and is enforced (402) |
| 4.6 | **Compliance**: wire `consent/withdraw` + `request/*` into the customer app | DPDP/GDPR require both (COMP-1 / BLOCKER-8) | M | A user can withdraw consent and track the request |
| 4.7 | Fix `WALLET_QUICK_ACTIONS` → `[]` in production builds | User-facing regression no test catches (FE-1) | S | Actions render in a production build |
| 4.8 | Delete 9 dead frontend constants | They imply the wallet is faked when it is not | S | Removed; `tsc` clean |
| 4.9 | Decide **build or delete** on the 3 orphan `coupon_*` tables + `ai_gateway_usage` + `service_categories` | Schema implies capability that does not exist | S | Migration drops them, or a ticket exists |

---

## PHASE 5 — Make the intelligence real

| # | Action | Why | Depends | Effort | Acceptance |
|---|---|---|---|---|---|
| 5.1 | **Fix BigQuery billing** | Analytics/ETL has produced zero successes since 2026-08-19; feature store, forecasting and MLOps are all downstream | — | S (billing) | ETL success rate > 95 % for 7 days |
| 5.2 | Label AI metrics `provider_mode="mock\|live"` | `homigo_ai_daily_cost_usd` currently meters imaginary spend (AI-1) | — | S | Dashboards distinguish mock from live |
| 5.3 | Set an AI budget policy, **then** enable one provider key in a sandbox | Whole assistant layer is built and governed but inert | 4.5, 5.2 | S | A real completion returns; budget enforces; PII scrub verified against a live call |
| 5.4 | Seed the knowledge base; resolve the duplicate `ask` endpoints | RAG stack complete, 0 documents (UNW-5) | 5.3 | M | Retrieval returns grounded answers; one endpoint remains |
| 5.5 | Promote `cancellation-risk.v1` from evaluation to a shadow decision | Real, leakage-clean model driving nothing | 5.1 | M | Shadow scores logged; decision impact measured before activation |
| 5.6 | Wire the Dynamic Pricing Engine behind `booking-pricing.service` (never to the client) | Built revenue lever with zero consumers (UNW-3); avoid creating a second price authority | 5.1 | L | Surge observable; one price authority |
| 5.7 | ETA: blend external provider + learned offset | Own model is 33 % worse than Google; recalibration beats training | 5.1 | M | MAE beats current baseline |

---

## PHASE 6 — Operability & scale structure

| # | Action | Why | Effort | Acceptance |
|---|---|---|---|---|
| 6.1 | **Extract the 22 schedulers into a worker deployment** | They share the API event loop and pool; leader locking already makes this safe (PERF-6) | L | API process runs no timers; jobs still exclusive |
| 6.2 | Push dispatch distance filtering into Postgres (PostGIS/bounding box) | Candidate scan is application-side; fine at 324 providers, not at 10k (PERF-4) | M | Candidate set bounded by the DB |
| 6.3 | Emit `presence.stale` on transition, not every sweep | 150 of 151 observed events were presence; receipts already 18,713 rows (PERF-5) | S | Event volume tracks real transitions |
| 6.4 | Unused-index analysis; drop dead indexes on write-hot tables | 937 indexes, never analysed (PERF-2) | M | `idx_scan = 0` set reviewed |
| 6.5 | Regression tests for the documented pool/lock traps (`FOR NO KEY UPDATE`, no base-client calls in money tx) | Fixed but unguarded (PERF-3) | M | Tests fail if reintroduced |

---

## PHASE 7 — Shared contract layer (structural, high leverage)

| # | Action | Why | Effort | Acceptance |
|---|---|---|---|---|
| 7.1 | **Create `packages/api-types`; generate from backend schemas; consume in all 5 clients** | Each client hand-declares response shapes; 6/6 clean typechecks prove nothing about the wire (ARCH-1). This is also why perf fixes never propagate (PERF-7) | L | Clients import types; a backend shape change breaks client builds |
| 7.2 | `packages/ui` or a shared config for cross-app perf defaults | partner-web ships ~227 kB vs customer web's 188 kB | L | Shared JS within 10 % across web apps |
| 7.3 | Contract tests: client fixtures validated against real backend responses | Catches null/optional drift types cannot | M | CI fails on contract drift |

---

## PHASE 8 — Staging, then production

Follow `enterprise-2035-production-readiness.md` §6 (Phases 1–6 there). Summary:
managed Postgres + PITR → off-host backups + restore drill → configure Resend → Sentry to a staging project → Alertmanager to a real human → load test with rate limiting **on** → mobile device certification → SLOs + capacity plan.

---

## PHASE 9 — 2035 evolution (only when scale demands it)

Each item states the trigger that would justify it. **Do none of them early.**

| Capability | Current | Trigger to act | Target |
|---|---|---|---|
| External search | Postgres `contains` | > ~5k services, or typo-tolerance/synonyms become product requirements | Postgres FTS first; OpenSearch only if that fails |
| Message broker | Postgres outbox | Outbox lag becomes the bottleneck, or cross-service consumers appear | Keep the outbox; add a broker downstream, never replace it |
| Service extraction | Modular monolith | A module needs independent scaling or release cadence | Extract dispatch or analytics first — both already have clean seams |
| Multi-region | Single region | Regulatory or latency requirement | Read replicas first |
| Multi-tenancy | Single tenant | A B2B/franchise business line | Row-level isolation before schema-per-tenant |
| Vector retrieval | Embedding code ready, unused | Knowledge base populated and used | pgvector in the existing Postgres |
| Feature store | Built, blocked | ETL healthy for a quarter | Existing `analytics/feature-store` |
| i18n | `preferredLanguage` only | Non-English market entry | Framework across all 5 clients |
| Streaming analytics | Batch ETL | Real-time ops decisions need sub-minute data | Existing event bus as the source |

**The modular monolith is the right architecture for HOMEEIGO's current scale (704 bookings, 324 providers).** Distribution would add failure modes without removing any current constraint. The one structural change worth making now is extracting the **worker tier** (6.1), because schedulers competing with request handling is a real, present limitation.

---

## Execution order (dependency-aware)

```
MUST FIX NOW      0.1-0.4  repository truth
                  1.1-1.2  schema reproducibility      <- blocks staging & production
                  1.3-1.6  database hygiene
                  2.1-2.3  dev bypasses, secrets, required config
                  3.1      wallet invariant            <- prevents silent money drift

MUST BUILD NEXT   4.1      operator remediation surfaces
                  4.2-4.3  customer + partner intelligence, partner self-service
                  4.6      compliance withdrawal
                  3.3-3.5  drain stranded refunds, backfill earnings

MUST VERIFY       1.2, 2.5, 6.5, 7.3   CI gates that prevent recurrence
                  Phase 8 staging      restore drill, load test, alert delivery

SHOULD BUILD      5.1-5.4  fix BigQuery, honest AI metrics, one live provider, seed RAG
                  6.1-6.3  worker tier, geo prefilter, presence transitions
                  7.1      shared api-types package

CAN DEFER         5.5-5.7  model promotion, dynamic pricing, ETA blending
                  6.4, 7.2 index pruning, shared UI
                  4.9      orphan schema cleanup

2035 FUTURE       Phase 9  each gated on an explicit trigger
```
