# HOMEEIGO — Enterprise 2035 Master System Audit

**Date:** 2026-09-21 · **Branch:** `cursor/stage-e-step-13-certification` · **Method:** static extraction + live HTTP probes + read-only SQL against a running stack

This document supersedes the 60+ historical certification reports in the repository root, several of which claim finality and contradict each other.

**Companion documents:** `feature-matrix` · `engine-inventory` · `api-inventory` · `database-inventory` · `runtime-status` · `dead-code-report` · `unwired-features` · `ai-ml-assessment` · `security-assessment` · `performance-assessment` · `production-readiness` · `roadmap` · `master-matrix`

---

## 1. Executive reality

HOMEEIGO is a **large, unusually well-engineered modular monolith** that is roughly 86 % connected to its own user interfaces, has a provably correct money core, and has never been deployed to production.

Three sentences capture the state:

1. **The engineering quality is high and the code is honest about itself.** Zero `TODO`/`FIXME`/`HACK` across ~3,200 production source files. All six TypeScript projects compile clean. Modules that use heuristics say so — `revenue-anomaly` declares itself *"`STATISTICAL` and never `ML`"*; `eta-intelligence` says *"NO ML inference"*; `vision-intelligence` says *"A fallback result is a test of the pipeline; it is not a test of the model."* This is rarer than it sounds and it materially raised the quality of this audit.

2. **The dominant problem is not missing capability or dead code — it is disconnection.** Of 662 distinct backend paths, 568 are consumed by at least one of the five client apps and **~88 are finished, tested, reachable business capability that no interface calls.** Entire subsystems — the Dynamic Pricing Engine, Customer Intelligence for customers, partner self-service lifecycle, operator remediation controls — exist and are unreachable.

3. **The path to production is blocked by four operational facts, not by architecture.** The migration history cannot rebuild the schema (3 rolled-back migrations); real third-party credentials sit in a plaintext `.env`; two dev bypasses that disable rate limiting and enable payment mocks are currently active; and there is no off-host backup or PITR.

**No greenfield rewrite is warranted.** No subsystem was found fundamentally unfit for its purpose.

---

## 2. What the system actually is

| Layer | Reality |
|---|---|
| **Backend** | Bun + Elysia, 1,275 source files, 49 route modules, **794 handler call-sites**, 240 services, 128 lib modules, 46 event modules, plus an 18-file `analytics/` tree **outside** `src/` |
| **Database** | PostgreSQL, **218 Prisma models / 220 tables**, 150 enums, 937 indexes, **1,838 CHECK constraints**, 171 FKs, 34 triggers, 125 migrations, 1,060 MB |
| **Customer web** | Next.js, 29 pages, 227 components |
| **Partner web** | Next.js, 54 pages, 84 components |
| **Admin panel** | Next.js, **105 pages**, 96 components |
| **Customer mobile** | Expo 54 / RN 0.81, 29 screens |
| **Partner mobile** | Expo 54 / RN 0.81, 22 screens + background GPS |
| **Async** | Postgres outbox + 8 in-process consumers, 22 scheduled jobs, 5 WebSocket routes, Redis leader lock with Postgres advisory fallback |
| **Shared code** | **None.** No `packages/` workspace; each client hand-declares backend types |

---

## 3. Dependency graph — verified end to end

```
USER
 └─ FRONTEND (5 apps, 555 distinct /api paths referenced)
     └─ API CLIENT (per-app api-base.ts + services/*-api.ts)   [no shared types]
         └─ HTTP / WS  →  :3000                                 ✅ 200/401 verified
             └─ ELYSIA ROUTE (49 modules, 794 handlers)          ✅
                 └─ AUTH PLUGIN (1 raw LEFT JOIN, 3 revocation mechanisms)  ✅ 401 + forged-JWT verified
                     └─ ADMIN RBAC (199 rules, fails closed 3 ways, audited) ✅
                         └─ DOMAIN SERVICE (240)                 ✅
                             ├─ POSTGRES  ✅ 2 ms, ledger balance = 0
                             ├─ REDIS     ✅ 2 ms (historically unstable → Postgres fallback worked)
                             ├─ OUTBOX    ✅ 151 published
                             └─ EXTERNAL  Razorpay ✅ · Twilio ✅ · Maps ✅ · Weather ✅
                                          Resend ❌ · BigQuery ⛔ billing · LLM ❌ no key · S3 ❌ no bucket
                                 └─ EVENT → 8 CONSUMERS          ✅ 3 observed advancing
                                     └─ JOBS / NOTIFICATIONS     ✅ (email channel dead)
                                         └─ FRONTEND STATE       ✅ 568 paths consumed
                                                                 ❌ ~88 paths reach nothing
```

Every arrow except the mobile leg and WebSocket delivery was exercised during the audit.

---

## 4. What is working — stated plainly

These are backed by runtime evidence, not by reading intent out of source.

- **Double-entry ledger is exact.** 975 journals, 2,295 entries, global `SUM(debit_paise) − SUM(credit_paise) = 0`, **zero** unbalanced journals, zero NULL paise, zero orphan payments.
- **Authentication and authorization are enforced.** Unauthenticated probes to six protected surfaces returned 401; a forged JWT claiming `role: ADMIN` returned 401. Three independent revocation mechanisms (jti blacklist, auth epoch, account state) evaluate per request in a single query — a deliberate fix that replaced four Prisma round trips and yielded ~+60 % throughput.
- **The event backbone runs.** 151 events published through the outbox, three consumers advancing independently, `/ready` reporting `events: consistent`.
- **Leader election survived a real Redis outage.** ~349 `redis_unavailable` fallbacks and 2 lease losses were recorded — and in every case the Postgres advisory anchor held exclusivity and the job still ran. The designed failover was observed working in production runtime. This is the strongest reliability evidence in the audit.
- **Webhook handling is exemplary.** Signature verified *before* parsing; missing signature, unconfigured secret and bad signature all return an identical 401 so config state is never disclosed; idempotency keyed on the gateway event id or a SHA-256 of the raw body.
- **Pricing is server-authoritative.** `POST /api/bookings` accepts ids and quantities only — never an amount — with a source comment saying exactly that.
- **Schema rigour is real.** 1,838 CHECK constraints across 220 tables; zero destructive statements in all 125 migrations; `prebuild` and CI both run migration-safety and DDL-guard checks.
- **The frontend↔backend contract has no broken paths.** Every `/api/...` literal in all five clients resolves to a real handler. Every apparent mismatch proved to be an extraction artifact.

---

## 5. What is broken

| # | Finding | Evidence |
|---|---|---|
| 1 | **Analytics/ETL has produced zero successes since 2026-08-19** | `SUCCEEDED` max date 2026-08-19; `FAILED`+`RECOVERING` accumulating daily; error text: *"Billing has not been enabled for this project"* ×72 in 7 days |
| 2 | **Migration history cannot rebuild the schema** | 3 of 125 migrations recorded failed + rolled back; their objects exist anyway |
| 3 | **Autovacuum has never run** | `last_vacuum` and `last_autovacuum` = `never` on every table inspected |
| 4 | **329 MB table holding one row** | `provider_match_scores`: 1 row, 329 MB — the largest object in a 1,060 MB database |
| 5 | **53 payments stranded in `REFUNDING`** | aged 16–35 days; exactly matches 53 `INDETERMINATE` refund requests; recovery sweep gated off by an absent env var |
| 6 | **₹52,939 wallet drift across 24 users** | 11 hold a balance with **zero** wallet transactions; no invariant asserts the equality |
| 7 | **Wallet quick actions render empty in production** | `WALLET_QUICK_ACTIONS` → `[]` when `NODE_ENV=production`; tests never see it |
| 8 | **16 stuck workflows detected and unactionable** | `workflows/stuck` and `workflows/*/recover` both exist; no screen calls either |

---

## 6. What is mocked, and what that means

| Component | Behaviour today | Correctly gated? |
|---|---|---|
| **LLM inference** | Returns `[GROQ dry-run] Acknowledged: <echo>`; no provider key configured | Degrades through the adapters' intended path, but **nothing announces it** |
| **Vision analysis** | Deterministic fallback; no model exists | ✅ — the source says so and the UI shows *"coming soon"* |
| **Knowledge / RAG** | 0 documents, 0 chunks, no embedding key | ✅ built, honestly empty |
| **Customer-web demo data** | 9 dead constants + 2 live ones behind `NODE_ENV !== "production"` | ✅ gated — but see finding 7 |
| **Payment mocks** | `HOMIGO_ALLOW_PAYMENT_MOCKS=1` active | ⚠️ gated on `APP_ENV`, but **enabled right now** |

**The critical nuance on AI:** the control plane — budget reservation with 402 enforcement, a 115-tool catalogue with approval and policy logging (13,146 executions recorded), prompt firewall, provider failover with cooldowns, circuit breakers, fail-closed agents — is real, executes, and is well built. It currently governs mocked inference. That is a credentials decision, not a rewrite. But `homigo_ai_daily_cost_usd` reports non-zero spend for imaginary calls, and no metric distinguishes mock from live.

---

## 7. What is genuinely AI/ML, stated precisely

**Two real models exist**, both logistic regressions trained in-process on Postgres data with AUC, Brier score and Hanley–McNeil standard errors: `cancellation-risk.v1` and `provider-acceptance`. The first has exemplary leakage discipline — `EXCLUDED_FEATURES` names each excluded field with its reason (*"`payment_status` — EVOLVES: its value at prediction time differs from its value at read time"*), and examples are built in temporal order.

**Both drive no decision.** Each is reachable through exactly one admin evaluation endpoint, and **neither endpoint is called by any frontend**.

**Everything else marketed as intelligence is rules or statistics** — matching (rating + distance + availability, config-weighted), fraud, anomaly detection, recommendations, ETA — and the codebase says so itself rather than claiming otherwise.

---

## 8. Maturity by domain

| Domain | Level | Evidence |
|---|---|---|
| Architecture | **INTEGRATED** | Clean modular monolith, correct async model; no shared package layer; schedulers in-process |
| Backend | **VERIFIED** | 794 handlers, 0 TODOs, clean tsc, runtime-probed |
| Frontend (web) | **INTEGRATED** | 188 pages, real data; perf fixes don't propagate; 1 prod-only regression |
| Mobile | **FUNCTIONAL** | Both apps complete and typecheck clean; **never device-verified** |
| Security | **VERIFIED** | Runtime 401s + forged-JWT rejection, fail-closed RBAC, exemplary webhook; blocked on secrets/env hygiene |
| Database | **FUNCTIONAL** | Excellent constraint design; **unmanaged hygiene and unreproducible history** |
| Payments | **VERIFIED** | Ledger balance exactly 0; idempotent webhooks; stranded refund cohort |
| Booking | **VERIFIED** | Single-writer FSM, one documented dead state, heavy tests |
| Dispatch | **VERIFIED** | Live 30 s tick, leader-locked, zombie-offer bug already fixed |
| Matching | **FUNCTIONAL** | Rule-based and honest; app-side distance scan won't scale |
| Search | **FOUNDATIONAL** | Postgres `contains` |
| Real-time | **FUNCTIONAL** | 5 WS routes, revocable grants, close-race fixed; never load-tested |
| AI/ML | **FOUNDATIONAL** | Excellent governance, mocked inference, models that decide nothing |
| DevOps | **FUNCTIONAL** | Real CI with safety gates; no production deployment |
| Observability | **INTEGRATED** | 170 metrics, 38 dashboards, live stack; Sentry unproven in prod |
| Testing | **INTEGRATED** | 218 backend + 68 frontend files; suite unrunnable safely against the live DB |
| Data | **FOUNDATIONAL** | 34 % fixture contamination; drift; no retention |
| UX | **INTEGRATED** | Consistent design system; honest "coming soon" convention |
| Accessibility | **FUNCTIONAL** | axe-core runtime checks; contrast fixes recorded |
| Production readiness | **NOT PRESENT** | No production runtime exists |

---

## 9. The twenty questions, answered

1. **What exactly has been built?** A complete two-sided home-services marketplace: 794 backend handlers, 220 tables, 5 client apps (188 web pages + 51 mobile screens), a Postgres-outbox event system, 22 scheduled jobs, 5 WebSocket routes, a double-entry ledger, and an AI governance platform.

2. **What exactly is active?** Verified executing: HTTP API, auth/RBAC, catalogue, booking FSM, dispatch (30 s tick), payments, ledger, outbox + 3 consumers, 22 schedulers with leader election, AI tool governance, data-quality engine, log governance, observability.

3. **Used by Customer?** Catalogue, search, quote, address, booking lifecycle, chat, masked calling, tracking, payments, wallet (real balance), split checkout, refunds, H-Coins, gift cards, referrals, membership, coupons, reviews, support, notifications, legal/consent pages, AI + vision surfaces (mocked).

4. **Used by Partner?** Registration, KYC, documents, availability, service area, offer/accept/reject, en-route→complete, evidence, earnings, wallet, withdrawals (admin-side), invoices, reviews, academy, rewards, referrals, territory/performance/earnings HQ (real `geo-intel` data), wellbeing/SOS, trust & compliance.

5. **Used by Admin?** 105 pages — dashboard, command centre, users, partners, bookings, payments, refunds, chargebacks, settlements, reconciliation, adjustments, fraud, KYC, services, membership, coupons, campaigns, reviews, support, knowledge, observability, alerts, automation/events, ML, digital twin, geospatial, heatmap, weather, partner acquisition, trust & safety, RBAC/team, audit, compliance.

6. **Backend-only?** ~88 endpoints (§ `unwired-features`), plus `/metrics`, `/ready`, webhooks, static uploads.

7. **Only in database/schema?** `coupon_segments`, `coupon_campaigns`, `coupon_rules`, `ai_gateway_usage`; `service_categories` holds 5 rows with no runtime reader.

8. **Dead code?** 4 orphan tables, `BookingStatus.REJECTED` (1 historical row, no writer), 9 unconsumed frontend constants, ~10 stray build/scratch directories, 60+ superseded root reports. **Zero dead route files and zero dead services.**

9. **Built but disconnected?** Dynamic Pricing (3), Customer Intelligence for customers (6), partner `me/intel/*` + lifecycle (7), analytics/MLOps (18), AI conversation/context/prompt tooling (~20), admin governance + finance remediation (18), knowledge (3), compliance withdrawal (2).

10. **Broken?** ETL (zero successes since 2026-08-19), migration history, autovacuum, 329 MB single-row table, 53 stranded refunds, ₹52,939 wallet drift, production wallet quick actions, 16 unactionable stuck workflows.

11. **Mocked/fake/placeholder?** LLM inference, vision analysis, 9 dev-only constants; `LOAD_TEST_MODE` and `HOMIGO_ALLOW_PAYMENT_MOCKS` active.

12. **Untested?** Membership (36 production call-sites : 1 test), WebSocket delivery under load, mobile runtime, production build behaviour, admin RBAC rule coverage, wire-contract compatibility.

13. **Environment-blocked?** BigQuery (billing), LLM (no key), Resend (no key), S3 (no bucket), Expo OTA (no token), Sentry production delivery, `PII_MASTER_KEY`, `ALLOWED_ORIGINS`.

14. **Needs owner/business decisions?** Build-or-delete the coupon campaign engine; SLO targets; AI budget figure; whether workflows leave SHADOW; data retention periods; partner calendar fixed-slot contract; ETA model promotion.

15. **Needs production infrastructure?** Managed Postgres + PITR, off-host backups, object storage, secret manager, production runtime, alert routing, autoscaling.

16. **Needs real credentials?** BigQuery billing, one LLM provider, Resend, S3/AWS, Expo, production Razorpay, production Sentry DSN.

17. **Needs physical devices?** Both mobile apps end to end — push, background GPS, maps, native Razorpay, OTA. Expo Go cannot run them (reanimated 4, maps, Razorpay natives); a USB dev build is required.

18. **Missing for enterprise grade?** Reproducible schema, secret management, DB hygiene + retention, money invariants in CI, shared type contracts, worker tier, load testing with rate limiting on, alert delivery to humans, SLOs.

19. **Missing for 2035 readiness?** Real search, live AI inference, models that drive decisions, streaming analytics, multi-region, multi-tenancy, i18n, API governance/versioning.

20. **What should be built FIRST?** **Fix the migration history (roadmap 1.1).** Nothing about staging or production is defensible until a fresh database can be built from the repository. Then: dev-bypass hard-fail, DB hygiene, and the wallet invariant.

---

## 10. One-page truth

**Where HOMEEIGO is today.** A feature-complete, well-engineered marketplace running as a full local stack, with a provably correct money core and enforced security — and no production deployment. The build phase is essentially done. The connect-and-operationalise phase has barely started.

**Working:** ledger (exact), auth/RBAC (runtime-verified), booking FSM, dispatch, payments, event backbone, leader-lock failover, catalogue, observability, log governance, schema constraints, migration safety gates.

**Partial:** refunds (53 stranded), earnings (18 missing), settlements/fraud consoles (detection without remediation), compliance (withdrawal unreachable), digital twin (2 of 4), knowledge (empty), tracking (never load-tested).

**Dead:** 4 orphan tables, 1 enum value, 9 frontend constants, 60+ superseded reports.

**Broken:** ETL since 2026-08-19, migration history, autovacuum, 329 MB single-row table, production wallet quick actions.

**Unwired:** ~88 finished endpoints — the defining finding.

**Risky:** real credentials in `.env`; rate limiting disabled by an active flag; no off-host backup; unbounded PII audit growth; 34 % fixture contamination in the reference database.

**Needs a business decision:** coupon engine build-or-delete; SLOs; AI budget; shadow-to-live for automation; retention periods.

**Needs infrastructure:** managed Postgres + PITR, object storage, secret manager, production runtime.

**Needs credentials:** BigQuery billing, one LLM key, Resend, S3, Expo.

**Needs devices:** both mobile apps.

**Build next:** migration reproducibility → dev-bypass hard-fail → DB hygiene → wallet invariant → operator remediation surfaces → customer/partner intelligence wiring.

**Can wait:** search engine, model promotion, dynamic pricing activation, multi-region, i18n, multi-tenancy, service extraction.

---

## 11. Audit limitations

Stated so no conclusion is read as broader than its evidence.

- **The backend test suite was not executed.** Project memory records that `bun test` from the repo root writes to the live `homigo_db`, and that a prior over-broad run deleted ~3,939 completed bookings. Running it would have corrupted the database this audit measures.
- **No load test was run**, for the same reason. All latency figures are single-client and local.
- **No mobile runtime verification** — requires physical devices.
- **No WebSocket delivery verification** — no client connected during the audit.
- **No production evidence exists**, because no production runtime exists.
- **Business volumes describe a contaminated database** (~34 % fixture data), not a production baseline.
- **The unwired-endpoint list is an aggregate with low but non-zero false-positive risk.** Three matcher refinements were needed; four individual claims were tested and withdrawn (§ `master-matrix` no-assumption matrix). Treat any single line as a lead; the aggregate is sound.
