# HOMEEIGO — Enterprise 2035 Master Matrix

Single consolidated table. `RV?` = runtime-verified in this audit. `PR?` = production-ready.

---

## 1. Master feature table

| Feature | Where | Apps | Backend | DB | API | Active | Used | Tested | RV? | PR? | Issues | Pri | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Auth / session | `plugins/auth.plugin.ts` | all 5 | ✅ | ✅ | `/api/auth/*` | ✅ | ✅ | ✅ | **✅ 401+forged** | ✅ | — | — | none |
| Admin RBAC | `middleware/admin-rbac.ts` | admin | ✅ | ✅ | all `/api/admin/*` | ✅ | ✅ | ✅ | ✅ | ◐ | no coverage test | P2 | SEC-1 |
| Service catalogue | `lib/service-catalog-*` | web, mob, admin | ✅ | ✅ | `/api/services/*` | ✅ | ✅ | ✅ | **✅ 200** | ✅ | — | — | none |
| Search | `routes/services.ts` | web, mob | ✅ | ✅ | `POST /search` | ✅ | ✅ | ✅ | ◐ | ◐ | Postgres `contains` only | P3 | FTS at ~5k services |
| Booking lifecycle | `booking.service` + FSM | all 5 | ✅ | ✅ | `/api/bookings/*` (26) | ✅ | ✅ | ✅ | ◐ | ✅ | `REJECTED` unreachable | P3 | document, keep |
| Pricing (booking) | `booking-pricing.service` | web, mob | ✅ | ✅ | `POST /api/bookings` | ✅ | ✅ | ✅ | ◐ | ✅ | server-authoritative | — | none |
| **Dynamic pricing** | `routes/pricing.ts` | **none** | ✅ | ✅ | `/api/pricing/*` | ✅ | **❌** | ✅ | ❌ | ❌ | **0 consumers** | **P1** | UNW-3 / 5.6 |
| Dispatch | `assignment-engine.service` | ptnr, admin | ✅ | ✅ | accept/reject | ✅ | ✅ | ✅ | **✅ 30 s tick** | ◐ | app-side distance scan | P2 | PERF-4 |
| Matching | `matching.service` | — | ✅ | ✅ | internal | ✅ | ✅ | ✅ | ◐ | ✅ | rules, not ML | — | correct as-is |
| Payments | `razorpay.service` | web, mob, admin | ✅ | ✅ | `/api/payments/*` | ✅ | ✅ | ✅ | ◐ configured | ◐ | test keys | P1 | live keys + email |
| Webhook | `routes/payments.ts` | — | ✅ | ✅ | `POST /webhook` | ✅ | ✅ | ✅ | ◐ | ✅ | exemplary | — | none |
| **Ledger** | journal/ledger svc | admin | ✅ | ✅ | `/api/admin/finance/*` | ✅ | ✅ | ✅ | **✅ balance=0** | ✅ | float cols beside paise | P2 | DB-5 |
| Wallet | `wallet.service` | all 5 | ✅ | ✅ | `/api/wallet/*` (18) | ✅ | ✅ | ✅ | ◐ | ❌ | **₹52,939 drift, 24 users** | **P1** | DB-6 / 3.1 |
| Wallet quick actions | `WalletQuickActions.tsx` | web | — | — | — | ✅ dev | ✅ | ❌ | ❌ | ❌ | **`[]` in production** | P2 | FE-1 / 4.7 |
| **Refunds** | `booking-refund.service` | web, mob, admin | ✅ | ✅ | `/api/payments/:id/refund` | ✅ | ✅ | ✅ | **✅ 53 stranded** | ❌ | recovery gated off | **P1** | DB-7 / 3.3 |
| Multi-source checkout | `routes/wallet.ts` | **none** | ✅ | ✅ | `/multi-source/*` | ✅ | **❌** | ✅ | ❌ | ❌ | 0 consumers | P3 | UNW-6 |
| Earnings / payouts | earning svc | ptnr, admin | ✅ | ✅ | `/api/providers/*` | ✅ | ✅ | ✅ | ◐ | ◐ | 18 w/o earning; `me/withdrawals` unwired | P1 | 3.5 / 4.3 |
| Settlements | settlement svc | admin | ✅ | ✅ | `/finance/settlements/*` | ✅ | ◐ | ✅ | ❌ | ◐ | investigate/notes unwired | P1 | OPS-1 / 4.1 |
| Membership | `subscription.service` | web, mob, ptnr, admin | ✅ | ✅ | `/api/subscriptions/*` | ✅ | ✅ | **⚠️ 36:1** | ❌ | ◐ | weakest test ratio | P2 | add tests |
| Coupons | `campaign.service` | web, mob, admin | ✅ | ✅ | internal | ✅ | ✅ | ✅ | ❌ | ✅ | 3 orphan tables | P3 | 4.9 |
| Partner onboarding/KYC | partner svc | ptnr, admin | ✅ | ✅ | `/api/partner/*` | ✅ | ✅ | ✅ | ❌ | ✅ | — | — | none |
| **Partner self-service** | `routes/providers.ts` | **none** | ✅ | ✅ | `me/lifecycle/*` | ✅ | **❌** | ✅ | ❌ | ❌ | cannot pause own availability | **P1** | UNW-2 / 4.3 |
| Partner intel (`geo-intel`) | `routes/geo-intelligence.ts` | ptnr, admin | ✅ | ✅ | `/api/geo-intel/*` | ✅ | ✅ | ✅ | ❌ | ✅ | — | — | none |
| Partner intel (`me/intel/*`) | `routes/providers.ts` | **none** | ✅ | ✅ | `me/intel/*` | ✅ | **❌** | ✅ | ❌ | ❌ | **duplicate backend** | **P1** | 4.4 |
| **Customer intel** | `routes/customer-intelligence.ts` | admin only | ✅ | ✅ | `/api/customer-intel/*` | ✅ | ◐ | ✅ | ❌ | ❌ | **customers blind** | **P1** | UNW-1 / 4.2 |
| Tracking / GPS | `tracking.ws`, Kalman | cust, ptnr | ✅ | ✅ | `/api/tracking/*`, WS | ✅ | ✅ | ✅ | ❌ | ◐ | no socket opened | P2 | WS load test |
| Presence | presence svc | ptnr, admin | ✅ | ✅ | internal | ✅ | ✅ | ✅ | **✅ 147 events** | ◐ | 99 % of event volume | P3 | PERF-5 |
| Notifications | `src/notifications/` | all 5 | ✅ | ✅ | `/api/notifications/*` | ✅ | ✅ | ✅ | ◐ | ❌ | **email not configured** | P1 | BLOCKER-9 |
| SMS (Twilio) | `channels/sms.adapter` | — | ✅ | ✅ | internal | ✅ | ✅ | ✅ | ◐ configured | ◐ | real creds in `.env` | P1 | SEC-4 |
| Email (Resend) | `email.service` | — | ✅ | ✅ | internal | **❌** | ❌ | ✅ | **✅ not configured** | ❌ | key empty | P1 | BLOCKER-9 |
| Push (Expo) | `expo-server-sdk` | mobile | ✅ | ✅ | internal | ✅ | ✅ | ✅ | ❌ | ◐ | device-blocked | P2 | device cert |
| WebSockets (5) | `src/websocket/` | all | ✅ | ✅ | `/ws/*` | ✅ | ✅ | ✅ | ❌ | ◐ | never load-tested | P2 | fan-out test |
| Event outbox + consumers | `events/core/` | admin | ✅ | ✅ | `/admin/automation/*` | ✅ | ✅ | ✅ | **✅ 151/3** | ✅ | — | — | none |
| Scheduler (22 jobs) | `lib/maintenance.ts` | — | ✅ | ✅ | internal | ✅ | ✅ | ✅ | **✅** | ◐ | in-process with API | P2 | PERF-6 / 6.1 |
| Leader lock | `distributed-scheduler.ts` | — | ✅ | ✅ | internal | ✅ | ✅ | ✅ | **✅ failover worked** | ✅ | — | — | none |
| **Workflows** | `src/automation/` | admin ◐ | ✅ | ✅ | `/governance/workflows/*` | ✅ | ◐ | ✅ | **✅ all SHADOW** | ❌ | **16 stuck, unactionable** | **P1** | OPS-1 / 4.1 |
| Audit log | `AuditLogService` | admin | ✅ | ✅ 401k | `/api/admin/audit` | ✅ | ✅ | ✅ | ✅ | ❌ | **no retention, never vacuumed** | **P1** | DB-3 / 1.5 |
| **Analytics / ETL** | `analytics/etl/` | **none** | ✅ | ✅ | `/api/analytics/*` | ✅ | **❌** | ✅ | **✅ 0 success since 08-19** | ❌ | **BigQuery billing off** | **P1** | 5.1 |
| Data quality | `analytics/data-quality` | none | ✅ | ✅ 7,581 | `/analytics/quality` | ✅ | ❌ | ✅ | **✅ score 100** | ◐ | unwired | P2 | 4.x |
| Feature store / forecast | `analytics/` | none | ✅ | ✅ | `/analytics/features/*` | ⛔ | ❌ | ✅ | ❌ | ❌ | downstream of ETL | P2 | after 5.1 |
| **AI gateway** | `src/ai/gateway/` | web, ptnr | ✅ | ✅ | `/api/ai/*` | ✅ | ◐ | ✅ | **✅ returns mocks** | ❌ | **no provider key** | **P1** | 5.2-5.3 |
| AI budget | `ai-budget.service` | **none** | ✅ | ✅ | `/governance/ai-budgets` | ✅ | **❌** | ✅ | ✅ 401 | ❌ | no policy, no UI | P1 | 4.5 |
| AI tools (115) | `src/ai-tools/` | admin | ✅ | ✅ 13k | `/api/ai/tools/*` | ✅ | ✅ | ✅ | ✅ | ◐ | approval order-sensitive | P2 | memory item |
| Agents | `src/agents/` | admin | ✅ | ✅ | `/api/agents/*` | ⛔ | ◐ | ✅ | ✅ fails closed | ◐ | disabled by default | P3 | explicit decision |
| Knowledge / RAG | `knowledge-*.service` | admin | ✅ | ✅ **0 rows** | 2 paths | ◐ | ◐ | ✅ | **✅ empty** | ❌ | duplicate endpoints | P2 | UNW-5 / 5.4 |
| Vision | `vision-intelligence.service` | web, admin | ✅ | ✅ | `/api/vision/*` | ✅ | ✅ | ✅ | ◐ | ◐ | **deterministic fallback** | P3 | honest today |
| ML models (2) | `cancellation-risk`, `provider-acceptance` | **none** | ✅ | ✅ | evaluation only | ✅ | **❌** | ✅ | ❌ | ◐ | drive no decision | P2 | 5.5 |
| ETA | `eta-intelligence.service` | admin | ✅ | ✅ | `/api/admin/eta*` | ✅ | ✅ | ✅ | ✅ 69.6 score | ◐ | labels only | P2 | 5.7 |
| Fraud / risk | `fraud-*.service` | admin ◐ | ✅ | ✅ | `/api/admin/fraud/*` | ✅ | ◐ | ✅ | ❌ | ◐ | decisions/unfreeze unwired | P1 | 4.1 |
| **Compliance / DSR** | `compliance.service` | admin only | ✅ | ✅ | `/api/compliance/*` | ✅ | ◐ | ✅ | ✅ 401 | ❌ | **withdraw unreachable** | **P1** | COMP-1 / 4.6 |
| Observability | `lib/observability.ts` | admin | ✅ | ✅ | `/metrics`, `/ready` | ✅ | ✅ | ✅ | **✅ 170 metrics** | ◐ | Sentry unproven in prod | P2 | staging |
| Log governance | `lib/log-governance.ts` | — | ✅ | ✅ | internal | ✅ | ✅ | ✅ | ✅ boot guard | ✅ | — | — | none |
| Storage | `object-storage.service` | all | ✅ | ✅ | `/api/uploads/*` | ✅ | ✅ | ✅ | ◐ local | ❌ | **no S3 bucket** | P1 | BLOCKER-4 |
| Backups | `scripts/backup-db.ts` | — | ✅ | ✅ | internal | ✅ | ✅ | ✅ | ◐ 2 local dumps | ❌ | **no off-host, no PITR** | **P0** | BLOCKER-4 |
| Feature flags | `feature-flag.service` | — | ✅ | ✅ | internal | ✅ | ✅ | ✅ | ❌ | ✅ | stable hash rollout | — | none |
| Mobile (customer) | `homigo-mobile` | — | ✅ | ✅ | 108 paths | ✅ | ✅ | ◐ | **❌ device** | ❌ | never device-tested | P1 | device cert |
| Mobile (partner) | `homigo-partner-mobile` | — | ✅ | ✅ | 113 paths | ✅ | ✅ | ◐ | **❌ device** | ❌ | never device-tested | P1 | device cert |
| i18n | — | — | ○ | ○ | ○ | ○ | ○ | ○ | ❌ | ❌ | not present | P3 | Phase 9 |
| Multi-tenancy | — | — | ○ | ○ | ○ | ○ | ○ | ○ | ❌ | ❌ | not present | P3 | Phase 9 |

---

## 2. No-assumption matrix

Every assumption tested during the audit, with the evidence that resolved it. Several were **wrong**, and are recorded as wrong.

| # | Assumption | Evidence sought | Verified? | Contradicting evidence | Final status |
|---|---|---|---|---|---|
| 1 | 6 route files are dead (not imported by `index.ts`) | grep for exported symbols | **NO** | mounted via `admin.ts:2670-2674` and `geo.ts:278` | **All 49 route files are wired** |
| 2 | 218 models all unused (first scan) | Prisma call-site count | **NO** | script bug — heredoc stripped `\b`, producing a backspace char | Script fixed; rerun gave 12 |
| 3 | 6 tables are orphans | table-name grep + live row counts | **NO** | `apps/backend/analytics/` (18 files) sits outside `src/` and was never scanned | **4 orphans**, not 6 |
| 4 | `ServiceVariant`/`ServiceAddon`/`DocumentSequence`/`OpsAlertAck` are dead | raw-SQL grep | **NO** | `$executeRaw` in `service-catalog-store.ts`, `booking-number.ts`, `ops-alert-ack.service.ts` | **ACTIVE via raw SQL** |
| 5 | `/api/user/me` is a broken contract (5 apps call it, no route) | route-file read | **NO** | declared via `.group("/api/user")` at `users.ts:355` | **Valid route** |
| 6 | 187 backend routes have no consumer | 3 successive matcher refinements | **PARTLY** | template literals with `()`, `?`, and suffix concatenation truncated | **94**, of which ~88 are genuine |
| 7 | Partner `*-hq` pages are placeholders | read page source | **NO** | call `partnerApi.partnerOs.forecast()`, `geoIntel.zoneScoring()`, `geoIntel.density()` | **Real data — duplication, not absence** |
| 8 | `/api/providers/me/service-area/zones` is unwired | targeted grep | **NO** | consumed by `partner-api.ts` via a ternary template literal | **Withdrawn** |
| 9 | `homigo_data_quality_score 100` is a hardcoded boot constant | trace callers | **NO** | `analytics/data-quality/engine.ts:96` computes it; 7,581 rows, latest 2026-09-20 | **Honest metric** (measures Postgres, not BigQuery) |
| 10 | Wallet balance is faked (`WALLET_TOTAL_BALANCE = 4250.75`) | trace consumers | **NO** | 0 consumers; real page uses `useWalletBalanceQuery` with an explicit "never fall back to a demo value" comment | **Dead constant; wallet is real** |
| 11 | `BookingStatus.REJECTED` is unreachable | writer grep + live count | **YES** | every `REJECTED` write targets another model; 1 historical row from 2026-06-09 | **Confirmed dead state** |
| 12 | Redis is broken (349 `redis_unavailable` fallbacks) | `/ready` + `redis-cli` + code read | **NO** | `PONG`, 2 ms healthy; counters cumulative; fallback = Postgres advisory anchor held | **Designed failover worked** |
| 13 | AI is fully operational | env keys + adapter branches | **NO** | no provider key; `mockResponse()` returns a dry-run echo | **Mocked inference, real governance** |
| 14 | ETL is healthy | live table query | **NO** | 0 successes since 2026-08-19; BigQuery billing disabled | **BROKEN** |
| 15 | Ledger has drift | live SQL invariants | **NO** | global 0, 0 unbalanced of 975 journals, 0 NULLs | **Perfectly balanced** |
| 16 | Wallet drift is only test users | e-mail pattern + txn counts | **PARTLY** | only 2 of 24 look synthetic; 11 have zero transactions | **Open invariant, not benign** |
| 17 | Migrations are clean | `_prisma_migrations` query | **NO** | 3 failed + rolled back, objects exist anyway | **History ≠ schema** |
| 18 | Autovacuum is running | `pg_stat_user_tables` | **NO** | `never` on every table inspected | **Never run** |
| 19 | Auth might be bypassable | live unauth + forged-JWT probes | **NO** | 401 on all 6 surfaces and on the forged token | **Enforced** |
| 20 | Knowledge base is populated | live row counts | **NO** | documents 0, chunks 0, authority rules 0 | **Empty** |

---

## 3. Findings index

| ID | Sev | Class | Finding | Doc |
|---|---|---|---|---|
| BLOCKER-1 / DB-4 | **P0** | DATABASE | 3 rolled-back migrations; history cannot rebuild schema | prod-readiness, database |
| BLOCKER-2 / SEC-4 | **P0** | SECURITY | Real credentials in plaintext `.env`; 2 prior incidents | security |
| BLOCKER-3 / SEC-3 | **P0** | SECURITY | `LOAD_TEST_MODE=1` (rate limit off) + payment mocks active | security |
| BLOCKER-4 | **P0** | INFRASTRUCTURE | No off-host backup, no PITR | prod-readiness |
| DB-1 / PERF-1 | **P1** | DATABASE | 329 MB table holding 1 row; ~⅓ of DB dead space | database, performance |
| DB-2 | **P1** | DATABASE | Autovacuum never run on any table | database |
| DB-3 / SEC-7 | **P1** | DATA | 575k PII-bearing audit rows, no retention | database, security |
| DB-6 | **P1** | DATA | ₹52,939 wallet drift, no invariant guarding it | database |
| DB-7 | **P1** | DATA | 53 payments stranded in `REFUNDING` 16–35 days | database |
| UNW-1 | **P1** | FRONTEND | Customer Intelligence invisible to customers | unwired |
| UNW-2 | **P1** | ARCHITECTURE | Duplicate partner-intel backends; lifecycle unreachable | unwired |
| UNW-3 | **P1** | BACKEND | Dynamic Pricing Engine has zero consumers | unwired |
| OPS-1 | **P1** | ARCHITECTURE | Detection without remediation (18 admin endpoints) | unwired |
| COMP-1 / SEC-6 | **P1** | COMPLIANCE | Consent withdrawal unreachable | unwired, security |
| SEC-2 | **P1** | SECURITY | `ALLOWED_ORIGINS` unset/undocumented | security |
| ETL-1 | **P1** | AI/ML | Zero ETL successes since 2026-08-19 (BigQuery billing) | runtime, ai-ml |
| AI-1 | P2 | OBSERVABILITY | AI cost metrics meter mocked calls | ai-ml |
| ARCH-1 | P2 | ARCHITECTURE | No shared package layer; types hand-declared per app | dead-code, engine |
| PERF-6 | P2 | ARCHITECTURE | 22 schedulers share the API event loop | performance |
| PERF-7 | P2 | FRONTEND | Perf fixes do not propagate between apps | performance |
| FE-1 | P2 | FRONTEND | Wallet quick actions render `[]` in production | dead-code |
| CFG-1 | P2 | DOCUMENTATION | `.env.example` diverges by 120 + 33 vars | unwired, prod-readiness |
| SEC-1 | P2 | SECURITY | No CI assertion of admin RBAC coverage | security |
| SEC-5 | P2 | SECURITY | `PII_MASTER_KEY` absent | security |
| DB-5 | P2 | DATA | Float money columns beside integer paise | database |
| UNW-4/5 | P2 | AI/ML | Analytics + knowledge surfaces unwired | unwired |
| DB-8 | P3 | DATA | 18 completed bookings without earnings | database |
| DB-9 | P3 | DATA | 111 zombie ETL executions | database |
| DB-10 | P3 | DATABASE | 4 orphan tables + `service_categories` unread | dead-code |
| PERF-5 | P3 | PERFORMANCE | Presence sweep is ~99 % of event volume | performance |
| SEC-8 | P3 | SECURITY | `TRUST_PROXY` unset | security |

---

## 4. Remediation status (2026-09-21)

A remediation pass ran after this audit. **Eight findings in the table above were re-measured and
proved wrong**, and twelve defects the audit missed were found and fixed.

See **`enterprise-2035-remediation-log.md`** for the full record, and these companions:
`migration-authority.md` · `finance-reconciliation.md` · `database-hygiene.md` · `etl-status.md`

| Audit finding | Revised status |
|---|---|
| DB-4 / BLOCKER-1 (migration history) | **WITHDRAWN** — replaced by MIG-1/2/3, all **FIXED**; rebuild passes 29/29 |
| DB-6 (wallet drift) | **WITHDRAWN** — real figure is ₹32, and the invariant existed and was firing |
| DB-7 (stranded refunds) | **WITHDRAWN as a defect** — deliberate fail-safe; replaced by REF-1 (visibility), **FIXED** |
| DB-2 (autovacuum never ran) | **WITHDRAWN** — statistics were lost, not vacuum |
| DB-3 / SEC-7 (audit retention) | **PARTLY WITHDRAWN** — `enterprise_audit_logs` is covered; `assignment_audits` is not (DBH-4, open) |
| DB-1 (bloat) | **CONFIRMED** — recurrence fixed; ~399 MB reclamation pending an operator window |
| SEC-2 (`ALLOWED_ORIGINS`) | **WITHDRAWN** — merged with defaults; replaced by SEC-10 (localhost in deployed CORS), **FIXED** |
| SEC-5 (`PII_MASTER_KEY`) | **WITHDRAWN** — wrong variable name; the real key is set and fails closed |
| SEC-3 (dev bypasses) | **PARTLY CONFIRMED** — load-test and payment mocks were already guarded; two AI bypasses were not (SEC-9), **FIXED** |
| OPS-1 (detection without remediation) | **PARTLY FIXED** — stuck-workflow surface built after fixing WFR-1, which made it buildable |
| ETL-1 (pipeline dead) | **CONFIRMED** — external; metric dishonesty **FIXED** |
