# HOMEEIGO — Enterprise 2035 Feature Matrix

Legend — **✅** implemented & wired · **◐** partial · **○** not present · **⛔** blocked · **✎** mock/placeholder

Status values: `ACTIVE` · `PARTIAL` · `BUILT_NOT_WIRED` · `WIRED_NOT_VERIFIED` · `BLOCKED` · `BROKEN` · `DEAD`

Surface counts: customer-web **29 pages**, partner-web **54**, admin **105**, customer-mobile **29 screens**, partner-mobile **22**.

---

## 1. Core commerce

| Feature | Backend | Cust Web | Cust Mob | Ptnr Web | Ptnr Mob | Admin | DB | Tests | Runtime evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Service catalogue | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | `/api/services` 200, 12.5 KB | **ACTIVE** |
| Service config (variants/addons) | ✅ | ✅ | ✅ | — | — | ✅ | ✅ raw SQL | ✅ | — | **ACTIVE** |
| Search | ✅ `contains` | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | — | **ACTIVE** (no FTS) |
| Quote / pricing | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ids+qty only, server-priced | **ACTIVE** |
| Dynamic pricing / surge | ✅ | ○ | ○ | ○ | ○ | ○ | ✅ | ✅ | **0 consumers** | **BUILT_NOT_WIRED** |
| Address management | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Booking create | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ heavy | 704 rows | **ACTIVE** |
| Booking lifecycle (FSM) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 9 statuses live | **ACTIVE** |
| Cancellation + policy | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 168 cancelled | **ACTIVE** |
| Reschedule | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Start PIN / OTP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Job evidence | ✅ | ◐ | ◐ | ✅ | ✅ | ✅ | ✅ 52 rows | ✅ | — | **ACTIVE** |
| Booking chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **WIRED_NOT_VERIFIED** |
| Masked calling | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | **WIRED_NOT_VERIFIED** |
| Reviews / ratings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |

## 2. Money

| Feature | Backend | Cust Web | Cust Mob | Ptnr Web | Ptnr Mob | Admin | DB | Tests | Runtime evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Razorpay orders + verify | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | `configured:true`, test keys | **ACTIVE** |
| Webhook (signature + dedup) | ✅ | — | — | — | — | — | ✅ | ✅ | auth-before-parse verified | **ACTIVE** |
| Wallet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | balance from API | **ACTIVE** |
| Wallet quick actions | ✅ | ✎ | — | — | — | — | — | — | **`[]` in production** | **BROKEN (prod)** |
| Split checkout | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Multi-source checkout | ✅ | ○ | ○ | — | — | ○ | ✅ | ✅ | **0 consumers** | **BUILT_NOT_WIRED** |
| Refunds | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | 36 done / 250 failed / **53 stranded** | **PARTIAL** |
| Double-entry ledger | ✅ | — | — | — | — | ✅ | ✅ | ✅ | **balance = 0 across 975 journals** | **ACTIVE** |
| Earnings | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | 18 completed w/o earning | **PARTIAL** |
| Withdrawals / payouts | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | `me/withdrawals` unwired | **PARTIAL** |
| Settlements | ✅ | — | — | — | — | ◐ | ✅ | ✅ | detail+export unwired | **PARTIAL** |
| Chargebacks | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Reconciliation | ✅ | — | — | — | — | ✅ | ✅ | ✅ | hourly + daily jobs | **ACTIVE** |
| Financial integrity runs | ✅ | — | — | — | — | ✅ | ✅ 15,560 | ✅ | — | **ACTIVE** |
| H-Coins / gift cards / referrals | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Membership / subscriptions | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⚠️ 36:1 | — | **ACTIVE** (under-tested) |
| Coupons | ✅ | ✅ | ✅ | — | — | ✅ | ✅ +3 orphan tables | ✅ | — | **ACTIVE** |

## 3. Supply / partner

| Feature | Backend | Ptnr Web | Ptnr Mob | Admin | DB | Tests | Runtime evidence | Status |
|---|---|---|---|---|---|---|---|---|
| Partner registration | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| KYC / documents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Background checks | ✅ | ◐ | — | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Availability | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | fixed-slot contract | **ACTIVE** |
| Self-service pause/resume | ✅ | ○ | ○ | — | ✅ | ✅ | **0 consumers** | **BUILT_NOT_WIRED** |
| Service area / zones | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Offer / accept / reject | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | dispatch tick live | **ACTIVE** |
| Dispatch engine | ✅ | — | — | ✅ | ✅ | ✅ | 30 s tick, leader-locked | **ACTIVE** |
| Matching / scoring | ✅ rules | — | — | ✅ | ✅ | ✅ | rating+distance+availability | **ACTIVE** |
| En route / arrive / start / complete | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 EN_ROUTE, 1 IN_PROGRESS | **ACTIVE** |
| Background GPS | ✅ | — | ✅ `expo-task-manager` | ✅ | ✅ | ✅ | **device-blocked** | **WIRED_NOT_VERIFIED** |
| Presence / liveness | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **147 presence events** | **ACTIVE** |
| Partner intelligence (`geo-intel`) | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | real data | **ACTIVE** |
| Partner intelligence (`me/intel/*`) | ✅ | ○ | ○ | ○ | ✅ | ✅ | **0 consumers — duplicate** | **BUILT_NOT_WIRED** |
| Academy / certifications | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | external artifacts | **PARTIAL** |
| Wellbeing / SOS | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | — | **WIRED_NOT_VERIFIED** |
| Trust & safety / incidents | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | **ACTIVE** |

## 4. Admin / operations

| Feature | Backend | Admin UI | DB | Tests | Runtime evidence | Status |
|---|---|---|---|---|---|---|
| Dashboard / command centre | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Users / partners / bookings / payments | ✅ | ✅ | ✅ | ✅ | 401 unauth | **ACTIVE** |
| Service catalogue admin | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Refunds / chargebacks / adjustments | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Settlement sync | ✅ | ◐ | ✅ | ✅ | investigate/notes unwired | **PARTIAL** |
| Fraud console | ✅ | ◐ | ✅ | ✅ | decisions/unfreeze unwired | **PARTIAL** |
| RBAC / team | ✅ | ✅ | ✅ | ✅ | fails closed, 199 rules | **ACTIVE** |
| Audit log | ✅ | ✅ | ✅ 401k | ✅ | **no retention** | **ACTIVE** |
| Observability console | ✅ | ✅ | ✅ | ✅ | 170 metrics, 38 dashboards | **ACTIVE** |
| Alert centre + WS | ✅ | ✅ | ✅ | ✅ | `ops.alert.raised` observed | **ACTIVE** |
| Automation / events console | ✅ | ✅ | ✅ | ✅ | outbox+DLQ views | **ACTIVE** |
| Workflow stuck/recover | ✅ | ○ | ✅ | ✅ | **16 detected, unactionable** | **BUILT_NOT_WIRED** |
| Workflow drafts review | ✅ | ○ | ✅ | ✅ | 11 DRAFT unreviewable | **BUILT_NOT_WIRED** |
| AI budget policy | ✅ | ○ | ✅ | ✅ | **cannot be set from UI** | **BUILT_NOT_WIRED** |
| ML registry / shadow | ✅ | ◐ | ✅ | ✅ | transitions unwired | **PARTIAL** |
| Analytics / data quality | ✅ | ○ | ✅ | ✅ | **unwired + pipeline broken** | **BLOCKED** |
| Knowledge console | ✅ | ✅ | ✅ 0 rows | ✅ | **empty base** | **PARTIAL** |
| Digital twin | ✅ | ✅ 2/4 | ✅ | ✅ | insights+simulate wired | **PARTIAL** |
| Geofences / heatmap / geospatial | ✅ | ✅ | ✅ | ✅ | — | **ACTIVE** |
| Weather | ✅ | ✅ | ✅ | ✅ | forecast+config unwired | **PARTIAL** |
| Partner acquisition (leads→approval) | ✅ | ✅ | ✅ 63 prod calls | ◐ | — | **ACTIVE** |
| Compliance / account deletion | ✅ | ✅ | ✅ | ✅ | **consent withdraw unreachable** | **PARTIAL** |

## 5. Platform

| Feature | Status | Runtime evidence |
|---|---|---|
| Event outbox + 8 consumers | **ACTIVE** | 151 published, 3 consumers advancing |
| Dead-letter queue + replay | **ACTIVE** | admin endpoints wired |
| Scheduler (22 jobs) | **ACTIVE** | leader lock + Postgres fallback exercised |
| Distributed leader lock | **ACTIVE** | ~349 Postgres fallbacks, 2 lease losses — **failover worked** |
| WebSockets (5 routes) | **WIRED_NOT_VERIFIED** | no socket opened during audit |
| Redis (cache/lock/ratelimit/presence) | **ACTIVE** (unstable) | healthy 2 ms; historical outage |
| Prometheus + Grafana + Alertmanager | **ACTIVE** | containers up; 38 dashboards |
| Sentry | **CONFIGURATION_ONLY** | DSN set; dev is a no-op by design |
| Backups | **PARTIAL** | 2 local dumps (48 MB, 64 MB); **no S3 bucket** |
| Log governance | **ACTIVE** | prebuild gate + boot guardrail + governed writer |
| Feature flags | **ACTIVE** | stable user-hash rollout |
| i18n | **○** | `preferredLanguage` only |
| Multi-tenancy | **○** | single tenant |

## 6. AI / ML

See `enterprise-2035-ai-ml-assessment.md`.

| Feature | Status |
|---|---|
| AI gateway + failover + circuit breaker | **ENVIRONMENT_BLOCKED** — no provider key, returns dry-run echo |
| AI budget enforcement | **ACTIVE** (no policy set, no UI) |
| AI tool governance (115 tools) | **ACTIVE** — 13,146 executions |
| Agent runtime | **CONFIGURATION_ONLY** — fails closed |
| Knowledge / RAG | **BUILT, EMPTY** — 0 documents |
| Vision | **CONFIGURATION_ONLY** — deterministic fallback |
| `cancellation-risk.v1` (real logistic regression) | **EVALUATION-ONLY** — drives no decision |
| `provider-acceptance` (real logistic regression) | **EVALUATION-ONLY** |
| ETA | **PARTIAL** — labels only, no inference |
| Demand forecasting | **BROKEN** — BigQuery billing |
| Matching / fraud / anomaly | **ACTIVE** — rules & statistics, correctly not called ML |

## 7. Mobile

Both apps: Expo 54 / RN 0.81, `expo-router`, `expo-secure-store`, `expo-notifications`, `expo-location`, `react-native-maps` 1.20.1, `react-native-razorpay`, `@sentry/react-native` 7.2, `expo-updates`. Partner adds `expo-task-manager` (background GPS). Both have `icon.png` + `adaptive-icon.png` (the P0 missing-icon issue recorded in project memory is **resolved**). Both typecheck clean.

| Capability | Cust Mob | Ptnr Mob | Verified? |
|---|---|---|---|
| Auth + secure storage + refresh | ✅ | ✅ | tsc only |
| Booking / payment (Razorpay native) | ✅ | — | **device-blocked** |
| Maps / tracking | ✅ | ✅ | **device-blocked** |
| Push notifications | ✅ | ✅ | **device-blocked** |
| Background GPS | — | ✅ | **device-blocked** |
| OTA updates | ✅ | ✅ | `EXPO_ACCESS_TOKEN` absent |
| Crash reporting | ✅ | ✅ | not verified |

**No mobile runtime verification was possible.** Expo Go cannot run these apps (native modules: reanimated 4, maps, Razorpay); a USB dev build on a physical device is required.

---

## 8. Roll-up

| Status | Approx. count |
|---|---|
| **ACTIVE** (wired end-to-end) | ~62 features |
| **PARTIAL** | ~18 |
| **BUILT_NOT_WIRED** | ~10 clusters (~88 endpoints) |
| **BLOCKED / BROKEN** | 5 (ETL, feature store, forecast, LLM inference, wallet quick actions) |
| **CONFIGURATION_ONLY** | 4 (agents, vision, S3, Sentry) |
| **DEAD** | 4 orphan tables, 1 enum value, 9 frontend constants |
| **NOT PRESENT** | i18n, multi-tenancy, external search, message broker, worker tier |
