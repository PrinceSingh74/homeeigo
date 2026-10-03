# HOMEEIGO — Enterprise 2035 Unwired Features

**This is the defining finding of the audit.** HOMEEIGO's problem is not missing capability and not dead code — it is a large volume of *finished, tested, reachable backend capability that no user interface calls.*

---

## 1. The measurement

| Metric | Value |
|---|---|
| Distinct backend paths | 662 |
| Consumed by ≥ 1 of the 5 client apps | **568 (86 %)** |
| No frontend consumer | **94 (14 %)** |
| Legitimately backend-only (infra/webhook/static) | ~6 |
| **Genuinely unwired business capability** | **~88** |

Method and caveats are in `enterprise-2035-api-inventory.md`. The matcher normalises `:param`, `[param]` and `${...}` to a wildcard and tolerates template suffixes; three successive refinements were needed to eliminate false positives (`/api/user/me` via `.group()`, `digital-twin/${encodeURIComponent(name)}/insights`, `` `/api/users/bookings${query}` ``). Remaining false-positive risk is low but non-zero — treat any single line as a lead, the aggregate as sound.

---

## 2. Legitimately backend-only (not defects)

| Path | Reason |
|---|---|
| `GET /metrics` | Prometheus scrape |
| `GET /ready` | orchestrator probe |
| `POST /api/webhooks/resend` | inbound provider webhook |
| `POST /api/payments/webhook` | Razorpay webhook (consumed by Razorpay) |
| `POST /api/payments/e2e/mock-signature` | test affordance, gated on `HOMIGO_ALLOW_PAYMENT_MOCKS` |
| `GET /uploads/ratings/*` | static file serving |

---

## 3. Whole subsystems with no user interface

### 3.1 Dynamic Pricing Engine — **fully unwired**

| Endpoint | Consumer |
|---|---|
| `GET /api/pricing/quote` | **none** |
| `GET /api/pricing/surge-forecast` | **none** |
| `GET /api/pricing/experiment` | **none** |

Zero references to `pricing/quote` in any of the five apps. Project memory records this as a completed Phase-4 track: a multiplier stack (traffic × weather × demand × scarcity × event) with revenue-optimal selection.

**Important nuance:** booking prices are *not* unpriced. `bookingPricingService` prices server-side from `POST /api/bookings` (the body schema accepts `variantId`, `quantity`, `addonIds` — **ids and quantities only, never a price**, with an explicit comment saying so). The pricing *engine* — surge, experiments, forecast — is what no surface exposes.

**P1 (BACKEND/FRONTEND).** A built revenue lever that cannot be used, observed or validated.

### 3.2 Analytics / ML platform — unwired *and* broken

`GET /api/analytics/quality`, `/quality/history/*`, `/freshness`, `/freshness/sla-violations`, `/features/*`, `/features/metadata`, `/features/export`, `/mlops/registry`, `/mlops/metrics`, `/versions/*`, `/versions/*/active`, `POST /versions/rollback`, `POST /etl/run`, `GET /etl/executions/*` — **14 endpoints, no consumer**.
Plus `GET /api/mlops/metrics`, `/api/admin/ml/demand/forecast`, `/api/admin/ml/shadow/*`, `POST /api/admin/ml/versions/*/transition`.

Compounding problem: the pipeline behind them has produced **zero successful runs since 2026-08-19** (BigQuery billing disabled). So even if wired, most would return stale or empty data.

**P2** — but only after the ETL block is resolved; wiring a UI to a dead pipeline would create a screen that lies.

### 3.3 Customer Intelligence — backend built, customer app blind

| Endpoint | Consumer |
|---|---|
| `GET /api/customer-intel/me` | **none** |
| `GET /api/customer-intel/recommendations` | **none** |
| `GET /api/customer-intel/rebooking` | **none** |
| `GET /api/customer-intel/maintenance` | **none** |
| `POST /api/customer-intel/recommendation-click` | **none** |
| `GET /api/customer-intel/satisfaction/*` | **none** |

The **admin** panel does consume `/api/customer-intel/:userId` and `/match` (`admin-api.ts:2128,2132`). So operators can see customer intelligence; **customers cannot.** Health score, CLV, churn, recommendations and rebooking prompts all exist server-side and reach no customer.

**P1 (FRONTEND)** — the clearest revenue-adjacent gap in the platform.

### 3.4 Partner Intelligence — partner app blind

| Endpoint | Consumer |
|---|---|
| `GET /api/providers/me/intel/earnings-coach` | **none** |
| `GET /api/providers/me/intel/nudges` | **none** |
| `GET /api/providers/me/intel/shift-plan` | **none** |
| `GET /api/providers/me/intel/zones` | **none** |
| `GET /api/providers/me/lifecycle/history` | **none** |
| `POST /api/providers/me/lifecycle/pause` | **none** |
| `POST /api/providers/me/lifecycle/resume` | **none** |
| `GET /api/providers/me/withdrawals` | **none** |

**Verified, not assumed:** the partner `*-hq` pages are **not** placeholders. `ai-hq/earnings-coach` calls `partnerApi.partnerOs.forecast()` → `/api/providers/me/forecast` and `partnerApi.geoIntel.zoneScoring()` → `/api/geo-intel/zone-scoring`; `territory-hq/coverage-areas` calls `/api/geo-intel/provider-density`. They render real backend data.

The finding is therefore **duplication, not absence**: partner intelligence is served through `/api/geo-intel/*` and `/api/providers/me/{forecast,intelligence}`, while a parallel `/api/providers/me/intel/*` family sits unused. Two backends answer the same product question; one has no caller.

`lifecycle/pause` and `lifecycle/resume` are a different and more serious case: a partner cannot pause their own availability through any client, though the backend supports it. Likewise `me/withdrawals` — partners cannot list their own withdrawals.

(`/api/providers/me/service-area/zones` was initially flagged here and is **withdrawn** — it is consumed by `partner-api.ts` through a template literal containing a ternary, which the extractor truncated.)

**P1 (ARCHITECTURE/BACKEND)** — resolve the duplicate partner-intelligence backends, then wire `lifecycle/*` and `me/withdrawals`, which have no equivalent elsewhere.

### 3.5 Knowledge / RAG — unwired and empty

`POST /api/knowledge/ask`, `POST /api/knowledge/retrieve`, `GET /api/knowledge/scope` have no consumer. The admin console calls a **different** path — `/api/admin/knowledge/ask` (`knowledge-api.ts:285`).

Two parallel knowledge surfaces, only one used, and the underlying tables are empty (`knowledge_documents` 0, `knowledge_chunks` 0, `knowledge_authority_rules` 0).

**P2** — resolve the duplication before wiring either.

### 3.6 AI conversational + governance surfaces

`POST /api/ai/gateway/chat`, `POST /api/ai/customer`, `POST /api/ai/admin`, `GET /api/ai/cost`; conversation management (`/api/ai/brain/conversations`, `/*/pin`, `/*/summarize`, `/recall`); context management (`/api/ai/context`, `/cache`, `/cache/purge`, `/rebuild`, `/search`); prompt versioning (`/api/ai/prompt-versions/*/diff/*`, `/api/ai/prompts/*`); `POST /api/ai/memory/*/compress`; `POST /api/ai/tools/approvals/*/cancel`.

Customer web has `/ai` and `/vision` pages and partner-web has `/ai`, so *some* AI surface is wired — but the gateway chat entrypoint, cost view and the entire conversation/context/prompt-versioning admin toolkit are not.

**P2** — and moot until a provider key exists.

### 3.7 Admin governance and finance gaps

| Endpoint | Consumer | Note |
|---|---|---|
| `GET/PUT /api/admin/governance/ai-budgets` | **none** | AI spend cannot be capped from the UI |
| `GET /api/admin/governance/workflows/stuck` | **none** | 16 stuck workflows detected, invisible to operators |
| `POST /api/admin/governance/workflows/*/recover` | **none** | no way to recover them |
| `GET/POST /api/admin/governance/workflow-drafts`, `/*/review` | **none** | 11 DRAFT definitions unreviewable |
| `GET .../models/cancellation-risk/evaluation` | **none** | model results unreadable |
| `GET .../models/provider-acceptance/evaluation` | **none** | same |
| `GET /api/admin/finance/fraud-cases` | **none** | |
| `GET /api/admin/fraud/decisions` | **none** | |
| `POST /api/admin/fraud/commissions/*/unfreeze` | **none** | frozen commissions cannot be released |
| `POST /api/admin/finance/liabilities/snapshot` | **none** | |
| `GET /api/admin/finance/settlements/*`, `/*/export` | **none** | |
| `POST /api/admin/finance/settlement-sync/discrepancies/*/investigate`, `/notes` | **none** | discrepancies visible but not actionable |
| `GET /api/admin/finance/audit-export/*` | **none** | |
| `GET /api/admin/integrity/booking-consistency` | **none** | |
| `GET /api/admin/providers/*/score/history`, `/career/history` | **none** | |
| `GET /api/admin/support/intelligence/analytics` | **none** | |
| `GET /api/admin/observability/logs/export.json` | **none** | |
| `GET /api/admin/membership/assignment/metrics` | **none** | |

### OPS-1 (P1, ARCHITECTURE) — detection without remediation

The recurring pattern: **the platform detects a problem and gives operators no way to act on it.** 16 stuck workflows are counted in `/metrics`; `workflows/stuck` and `workflows/*/recover` both exist; no screen calls either. Settlement discrepancies are surfaced but `investigate`/`notes` are unreachable. Frozen commissions cannot be unfrozen.

This is worse than a missing feature, because dashboards imply someone can respond.

### 3.8 Smaller gaps

| Endpoint | Note |
|---|---|
| `POST /api/wallet/checkout/multi-source/quote` + `/pay` | multi-source checkout built, unreachable (the split path *is* wired) |
| `GET /api/weather/forecast`, `/api/weather/config` | admin has a `/weather` page; these two are unconsumed |
| `POST /api/digital-twin/*/scenario`, `/what-if` | `/insights` and `/simulate` **are** wired; these two are not |
| `POST /api/compliance/consent/withdraw` | GDPR/DPDP consent withdrawal has no UI — **compliance risk** |
| `GET /api/compliance/request/*` | data-subject request status not viewable |
| `GET /api/legal/policies` | |
| `GET /api/notifications/preferences/defaults` | |
| `POST /api/geo/checkin` | |
| `GET /api/partner/register/referral-code` | |
| `GET /api/auth/google/mobile-callback` | mobile OAuth callback — verify against native flow |
| `PATCH /api/auth/sessions/*/activity` | session activity tracking unused |
| `GET /api/vision/images/*/analysis` | |
| `GET /api/admin/intelligence/report-recipients` | |

**COMP-1 (P1, COMPLIANCE):** `POST /api/compliance/consent/withdraw` and `GET /api/compliance/request/*` are unreachable from any client. Under DPDP/GDPR a data subject must be able to withdraw consent and track their request. The backend supports it; no user can reach it.

---

## 4. The inverse — frontend calls with no backend route

**None found.** All five apps' `/api/...` literals resolve to real handlers. Every initially-flagged mismatch proved to be an extraction artifact.

This is a genuinely good result: there are no broken client→server contracts at the path level. (Payload-shape compatibility is a separate, unverified question — see ARCH-1 in the dead-code report.)

---

## 5. Config that exists but does not reach runtime

| Control | State |
|---|---|
| AI budget policy | Enforcement code is real (402 `BUDGET_EXCEEDED`); **no policy configured** — the endpoint honestly returns `NO_POLICY_CONFIGURED — AI spend is measured but not capped`; and no UI to set one |
| `REFUND_AUTO_RECOVERY_ENABLED` | Absent from `.env` → recovery sweep off → 53 payments stranded in `REFUNDING` for 16–35 days |
| `EVENTS_OUTBOX_ENABLED` / `EVENTS_CONSUMERS_ENABLED` | Absent from `.env`, but `/ready` reports both **true** and `status:"consistent"` — defaults are on. Project memory warns these are two independent flags read once at import; an outbox-on/consumers-off split publishes everything and delivers nothing while looking healthy. Currently correct. |
| `ENABLE_ETL_SCHEDULER` | Absent; scheduler runs anyway (data-quality results written 2026-09-20) |
| 33 env vars in `.env.example` never read by source | e.g. `ENABLE_AI`, `ENABLE_LIVE_TRACKING`, `ENABLE_PREMIUM_FEATURES`, `POSTHOG_KEY`, `AXIOM_TOKEN`, `API_BASE_URL`, `APP_NAME` — stale documentation implying switches that do not exist |
| 120 env vars read by source but absent from `.env.example` | undocumented operational surface, including `AGENTS_ENABLED`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `BLOCK_BOOT_ON_INTEGRITY_FAIL`, all 14 `AI_TOOL_*` and 9 `AGENT_*` knobs |

**CFG-1 (P2, DOCUMENTATION):** `.env.example` documents 124 variables; source reads 212. The overlap is partial in both directions. An operator provisioning a new environment from `.env.example` would miss 120 variables and set 33 that do nothing.

---

## 6. Priority summary

| ID | Severity | Class | Finding |
|---|---|---|---|
| UNW-1 | **P1** | FRONTEND | Customer Intelligence invisible to customers (6 endpoints) |
| UNW-2 | **P1** | ARCHITECTURE | Duplicate partner-intelligence backends; `intel/*` (4) unused, `lifecycle/*` (3) + `me/withdrawals` unreachable |
| UNW-3 | **P1** | BACKEND | Dynamic Pricing Engine has no consumer at all (3 endpoints) |
| OPS-1 | **P1** | ARCHITECTURE | Detection without remediation across workflows, settlements, fraud (18 admin endpoints) |
| COMP-1 | **P1** | COMPLIANCE | Consent withdrawal + DSR status unreachable |
| UNW-4 | P2 | AI/ML | Analytics/MLOps surfaces unwired *and* pipeline broken (18 endpoints) |
| UNW-5 | P2 | AI/ML | Two parallel knowledge endpoints; base empty |
| CFG-1 | P2 | DOCUMENTATION | `.env.example` diverges from source by 120 + 33 variables |
| UNW-6 | P3 | FRONTEND | Multi-source wallet checkout, weather forecast, twin scenarios unwired |
