# HOMEEIGO — Enterprise 2035 Engine Inventory

Every engine found in code, with its authoritative location, whether it is wired, whether it executes, and whether a duplicate exists.

`apps/backend/src` holds **240 services**, **128 lib modules**, **49 route modules**, **46 event modules**, **29 automation modules**, plus `apps/backend/analytics` (18 modules, outside `src/`).

---

## 1. Engine table

| Engine | Authoritative location | Wired | Executes | Tested | Duplicate? | Status |
|---|---|---|---|---|---|---|
| **Auth / Session** | `plugins/auth.plugin.ts`, `services/token-revocation` | ✅ | ✅ **runtime-verified (401)** | ✅ | No | ACTIVE_AND_EXECUTED |
| **RBAC** | `middleware/admin-rbac.ts` + `lib/admin-route-permissions.ts` (199 rules) | ✅ | ✅ fails closed | ✅ | No | ACTIVE_AND_EXECUTED |
| **Service Catalog** | `lib/service-catalog-store.ts`, `service-catalog-config.ts`, `service-domain.ts` | ✅ | ✅ `/api/services` 200 | ✅ | No | ACTIVE_AND_EXECUTED |
| **Service Config** | `lib/service-catalog-config.ts` (zod, ≤30 variants, ≤20 addons, dup detection) | ✅ | ✅ | ✅ | No | ACTIVE_AND_EXECUTED |
| **Price / Quote** | `services/booking-pricing.service.ts` | ✅ | ✅ | ✅ | **See §2.1** | ACTIVE_AND_EXECUTED |
| **Dynamic Pricing** | `routes/pricing.ts` + pricing services | ✅ backend | ❓ | ✅ | Sibling of above | **DISCONNECTED — no consumer** |
| **Booking** | `services/booking.service.ts` + 16 siblings; FSM in `lib/booking-state-machine.ts` | ✅ | ✅ | ✅ heavy | No | ACTIVE_AND_EXECUTED |
| **Availability** | `services/booking-validation`, `partner-availability-fsm.ts` | ✅ | ✅ | ✅ | No | ACTIVE |
| **Dispatch** | `services/assignment-engine.service.ts` (1,069 lines) | ✅ | ✅ 30 s tick live | ✅ | No | ACTIVE_AND_EXECUTED |
| **Matching** | `services/matching.service.ts` (468 lines) | ✅ | ✅ | ✅ | No | ACTIVE — **rule-based** |
| **Payment** | `services/payment.service`, `razorpay.service`, `routes/payments.ts` | ✅ | ✅ configured | ✅ | No | ACTIVE_AND_EXECUTED |
| **Wallet** | `services/wallet.service`, `routes/wallet.ts` (18 handlers) | ✅ | ✅ | ✅ | No | ACTIVE |
| **Refund** | `services/booking-refund.service`, `admin refund path` | ✅ | ✅ partial | ✅ | No | **PARTIAL — 53 stranded** |
| **Ledger** | journal/ledger services | ✅ | ✅ **balance = 0 verified** | ✅ | No | ACTIVE_AND_EXECUTED |
| **Notification** | `src/notifications/` (router, channels, governance, preferences, templates) | ✅ | ✅ | ✅ | No | ACTIVE — **email unconfigured** |
| **Search** | `routes/services.ts` + Postgres `contains` | ✅ | ✅ | ✅ | No | ACTIVE — **no FTS/vector** |
| **Location / Geo** | `routes/geo.ts`, `lib/geo.ts`, OSRM + Google Maps | ✅ | ✅ | ✅ | No | ACTIVE |
| **Tracking** | `routes/tracking.ts`, `websocket/tracking.ws.ts`, Kalman GPS | ✅ | ❓ no socket opened | ✅ | No | SOURCE_PLUS_TEST |
| **Review** | `routes/ratings.ts`, review services | ✅ | ✅ | ✅ | No | ACTIVE |
| **Membership** | `services/subscription.service`, entitlements engine | ✅ | ✅ | ⚠️ **36 prod / 1 test** | No | ACTIVE — under-tested |
| **Coupon** | `services/campaign.service`, `campaign-limits.service` | ✅ | ✅ | ✅ | **See §2.2** | ACTIVE + orphan schema |
| **Support** | `routes/support.ts`, support services | ✅ | ✅ | ✅ | No | ACTIVE |
| **Analytics / ETL** | `analytics/etl/*`, `scheduler/etl-scheduler.ts` | ✅ | ✅ but **all runs fail** | ✅ | No | **BROKEN (BigQuery billing)** |
| **Data Quality** | `analytics/data-quality/engine.ts` | ✅ | ✅ score 100, 7,581 rows | ✅ | No | ACTIVE_AND_EXECUTED |
| **Feature Store** | `analytics/feature-store/service.ts` | ✅ | ⛔ downstream of ETL | ✅ | No | BLOCKED |
| **Forecast** | `analytics/forecast/demand-*.service.ts` | ✅ | ⛔ | ✅ | No | BLOCKED |
| **AI Gateway** | `src/ai/gateway/ai-gateway.ts` | ✅ | ✅ **but returns mocks** | ✅ | No | ENVIRONMENT_BLOCKED |
| **AI Tools** | `src/ai-tools/` (approval, policy, security, audit, bridge, execution) | ✅ | ✅ 13,146 executions | ✅ | No | ACTIVE_AND_EXECUTED |
| **Agent Runtime** | `src/agents/` | ✅ | ⛔ `AGENTS_ENABLED` absent → fails closed | ✅ | No | CONFIGURATION_ONLY |
| **Knowledge / RAG** | `services/knowledge-*.service.ts` | ✅ | ⛔ 0 documents, no key | ✅ | **See §2.3** | BUILT, EMPTY |
| **ML Registry / Shadow** | `services/ml-registry`, `ml-shadow`, `mlops.service` | ✅ | ✅ | ✅ | No | ACTIVE, unwired UI |
| **Workflow / Automation** | `src/automation/` (29 modules), `events/jobs/workflow-step.job.ts` | ✅ | ✅ **all `mode=SHADOW`** | ✅ | No | ACTIVE — shadow only |
| **Queue / Outbox** | `events/core/outbox-processor.ts`, `job-processor.ts` | ✅ | ✅ **151 published** | ✅ | No | ACTIVE_AND_EXECUTED |
| **Event Bus** | `events/core/event-bus.ts` + 8 consumers | ✅ | ✅ **3 consumers advancing** | ✅ | No | ACTIVE_AND_EXECUTED |
| **Scheduler** | `lib/maintenance.ts` (22 timers) + `lib/distributed-scheduler.ts` | ✅ | ✅ leader lock exercised | ✅ | No | ACTIVE_AND_EXECUTED |
| **Audit** | `AuditLogService`, `enterprise_audit_logs` (401k rows) | ✅ | ✅ | ✅ | No | ACTIVE — **no retention** |
| **Reporting** | `events/jobs/executive-report.job.ts`, finance reports | ✅ | ✅ | ✅ | No | ACTIVE, partly unwired |
| **Configuration** | `lib/production-config.ts`, `services/feature-flag.service.ts` | ✅ | ✅ | ✅ | No | ACTIVE |
| **Fraud / Risk** | `services/fraud-*.service`, `partner-risk`, `financial-risk` | ✅ | ✅ | ✅ | No | ACTIVE — **rules, not ML** |
| **Vision** | `services/vision-intelligence.service.ts` | ✅ | ✅ **deterministic fallback** | ✅ | No | CONFIGURATION_ONLY |
| **Geo-Intelligence** | `routes/geo-intelligence.ts` (8 endpoints) | ✅ | ✅ | ✅ | **See §2.4** | ACTIVE |
| **Digital Twin** | `routes/digital-twin.ts` | ✅ | ✅ admin consumes 2 of 4 | ✅ | No | PARTIAL |
| **Customer Intelligence** | `routes/customer-intelligence.ts` | ✅ | ✅ admin only | ✅ | No | **PARTIAL — customer blind** |
| **Compliance / DSR** | `routes/compliance.ts`, `services/compliance.service` | ✅ | ✅ | ✅ | No | **PARTIAL — withdraw unreachable** |
| **Storage** | `services/object-storage.service`, `document-upload.service` | ✅ | ✅ local disk | ✅ | No | **CONFIGURATION_ONLY — no S3 bucket** |
| **Observability** | `lib/observability.ts`, `metrics`, 38 Grafana dashboards | ✅ | ✅ 170 metrics | ✅ | No | ACTIVE — Sentry no-op in dev |
| **Log Governance** | `lib/log-governance.ts` + 3 barriers | ✅ | ✅ boot guardrail | ✅ | No | ACTIVE_AND_EXECUTED |

---

## 2. Duplication findings

### 2.1 Two pricing surfaces — acceptable, but must be reconciled

- `booking-pricing.service.ts` prices bookings server-side (authoritative, used).
- `routes/pricing.ts` exposes the dynamic-pricing multiplier stack (surge, experiment, forecast) — **no consumer**.

These are not duplicate implementations of the same calculation; they are two layers that were never joined. The risk is that if the pricing engine is later wired into checkout, two independent price authorities exist.

**Action:** decide whether the dynamic engine feeds `booking-pricing.service` (one authority) or remains an analytics surface. Do not wire it to the client directly.

### 2.2 Coupon: one live engine, one orphan schema

`campaign.service` + `campaign-limits.service` + `CouponUsage` are live. `CouponSegment` / `CouponCampaign` / `CouponRule` are **orphan tables with no code** (0/0/1 rows). A schema reader would reasonably conclude a segmented campaign engine exists. It does not.

### 2.3 Two knowledge endpoints

`POST /api/knowledge/ask` (unconsumed) vs `POST /api/admin/knowledge/ask` (consumed by admin). Same underlying services. Resolve to one.

### 2.4 Two partner-intelligence backends — **verified**

| Family | Consumer |
|---|---|
| `/api/geo-intel/*` (zone-scoring, provider-density, demand-forecast, surge, eta) | ✅ partner-web `*-hq` pages |
| `/api/providers/me/forecast`, `/api/providers/me/intelligence` | ✅ partner-web |
| `/api/providers/me/intel/{earnings-coach,nudges,shift-plan,zones}` | ❌ **none** |

Two backends answer the same product question. One has no caller.

### 2.5 No shared package layer — the structural duplication

There is **no `packages/` workspace**. The root `package.json` declares workspaces only for the two mobile apps. Consequences observed:

- `api-base.ts` exists once per web app (deliberate, documented).
- Each of the 5 clients **hand-declares** backend response types. All 6 projects typecheck clean; that proves nothing about wire compatibility.
- Performance fixes do not propagate (partner-web is ~39 kB behind customer web).

**This is the highest-leverage structural change available.**

---

## 3. Engines that do not exist

| Expected | Reality |
|---|---|
| Search engine (Elasticsearch/OpenSearch/vector) | Postgres `contains`. Adequate now; will not scale. |
| Message broker (Kafka/RabbitMQ/SQS) | Postgres outbox + in-process consumers. Correct choice at this scale. |
| Dedicated worker/queue service | 22 `setInterval` timers **inside the API process** (PERF-6). |
| Feature-flag service (LaunchDarkly-class) | `services/feature-flag.service.ts` with stable user-hash rollout — genuinely implemented. |
| Multi-tenancy | None. Single-tenant. |
| i18n framework | `preferredLanguage` in notification preferences; no app-level i18n. |

---

## 4. Engine health summary

| Status | Count | Engines |
|---|---|---|
| **ACTIVE_AND_EXECUTED** (runtime-verified) | 14 | Auth, RBAC, Catalog, Booking, Dispatch, Payment, Ledger, Event Bus, Outbox, Scheduler, AI Tools, Data Quality, Log Governance, Service Config |
| **ACTIVE** (wired, executes, not runtime-observed) | 13 | Matching, Wallet, Notification, Search, Geo, Review, Membership, Coupon, Support, Fraud, Audit, Reporting, Configuration |
| **PARTIAL** | 6 | Refund, Customer Intelligence, Digital Twin, Compliance, Tracking, Geo-Intelligence |
| **BLOCKED / BROKEN** | 4 | Analytics ETL, Feature Store, Forecast, AI Gateway inference |
| **CONFIGURATION_ONLY** | 4 | Agent Runtime, Vision, Storage (S3), Sentry |
| **DISCONNECTED** | 2 | Dynamic Pricing, Knowledge/RAG |
| **Duplicated** | 4 clusters | pricing, coupon, knowledge, partner-intelligence |
