# PARTNER INTELLIGENCE — IMPLEMENTATION PLAN

Written after re-reading `PARTNER_INTELLIGENCE_AUDIT.md`, `PARTNER_INTELLIGENCE_STATE.md`,
`PHASE_8_DISCOVERY.md`, `PHASE_8_STATE.md`, and independently re-verifying the repository.

**No code has been written yet.**

---

## 1. Exact existing capabilities (verified, reusable)

| Substrate | Verified state |
|---|---|
| **Demand ML** | **REAL.** `forecastDemand(h)` → `vertex-ai.service.infer("model_demand_forecast")`, `source: "bigquery:arima_plus"`, confidence = inverse mean relative CI width. Not a rules engine pretending to be ML. |
| **Zone scoring** | **REAL, documented, bounded.** `geoIntelligenceService.zoneScoring()`: `composite = earning*0.4 + demand*0.3 + serviceHealth*0.3`, already decomposed into `earningScore` / `demandScore` / `serviceHealth` / `risk`. |
| **Surge** | **REAL and deterministic.** `surgePrediction()` = weather surge × demand/supply pressure per zone. Appears in **no** AI module. |
| **Weather** | `weatherService.getByCoords / getForecast / alertsFor / surgeMultiplier / etaAdjustmentFactor / vendorAvailabilityImpact`. |
| **Geo-intel envelope** | `intel()` wrapper gives L1/L2 cache, `confidence`, `freshness`, `source`, `generatedAt`, bounded Prometheus labels. **Throws on failure** (no silent fallback) — so callers must translate failure into an explicit state. |
| **AI Gateway** | `invokeAiGateway`, provider failover, prompt-injection screening, output validation, audit, cost. `/api/ai/partner` exists and enforces RBAC via `mapUserRoleToAiRole(role, "partner")`. |
| **Tool bridge** | `runToolConversation` exists in the gateway, gated on `options.tools.enabled`. Policy, approval, audit, idempotency and circuit-breaker all proven in Phase-8 P3-9. |
| **Partner READ tools** | 6 bound: `getPartnerProfile`, `getPartnerJobs`, `getPartnerPerformance`, `getPartnerEarnings`, `getPartnerDemand`, `getPartnerSchedule`. Every one resolves `providerId` server-side from `actor.actorId`. |
| **Feature flags** | `evaluateFlag` / `isFeatureEnabled` / `bucketFor`. Fail-closed by construction (missing row = off, lookup failure = off), environment-scoped, Redis-cached, stable per-subject rollout buckets, kill-switch support. |
| **Notification governance** | `router.routeNotification` plus `quiet-hours`, `cadence`, `cooldown`, `channel-policy`, `preferences`, `containment`, `decision-audit`, **`shadow-evidence`**. |
| **Automation** | Workflow registry, trigger/condition registries, step executor, `executionMode: "LIVE" \| "SHADOW"`, instance manager, idempotency keys. |
| **Certification** | `certifyAutomation` — defaults to `SHADOW`, requires a real human approver, `assertLiveAllowed` blocks uncertified LIVE. |
| **Scheduler** | 17 leader-locked timers via `runWithLeaderLock` (Redis SET NX EX + in-memory fallback). |
| **Partner surfaces** | Partner web `/(partner)/intelligence` + `PartnerAiPanel`; partner mobile consumes `/api/geo-intel/*` and `/api/providers/me/*`; Partner Map from P1-2. |

## 2. Exact missing capabilities

1. **No partner intelligence service.** Twelve `*-intelligence` services exist; none for partner.
2. **Partner context is 5 facts** (`partner-context.ts`, 73 lines): provider row, today's job count, active jobs, today's earnings, pending docs. No demand/surge/weather/location/zone/route/performance.
3. **Tools disabled on the partner surface.** `handleGatewayRequest` passes no `tools` option; only the customer chat path enables them.
4. **No structured intelligence contract** — the partner endpoint returns free text.
5. **No morning briefing job** (none of 17 timers), **no partner notification templates** at all.
6. **No surge automation workflow, no partner surge alert.**
7. **No coaching, no shift planner, no performance nudges.**
8. **No reasons / model version / rules version** on any partner-facing recommendation.
9. **No partner intelligence feature flags, no shadow layer, no certification, no admin oversight, no capability tests.**

## 3. Two defects that dictate the build order

Found while verifying the tool handlers — these change sequencing:

**D1 — `read.partner.getPartnerDemand` returns the ungrounded projection.** It calls
`partnerOsService.getForecast`, which computes `weeklyProjection = weekEarnings * 1.05` and
`monthlyProjection = monthEarnings * 1.08`. Enabling partner tools before fixing this would pipe
hardcoded growth factors straight into the copilot, where the LLM would restate them as forecasts.
**The multipliers must be resolved BEFORE tools are enabled.**

**D2 — `read.partner.getPartnerPerformance` is mislabeled.** It calls
`partnerOsService.getProviderIntelligence`, which returns repeat-customer stats
(`uniqueCustomers`, `returningCustomers`, `repeatCustomerRatePct`) — not acceptance, completion,
cancellation, response time or ratings. An LLM asked "how is my performance?" would answer with
retention numbers. Must be corrected or renamed before the copilot consumes it.

Both are classified `REAL_APPLICATION_DEFECT`, in-scope because they block Capability 1.

## 4. Dependency order (proven, overrides the default where noted)

```
0. D1 + D2 defect fixes            ← blocks everything that reads partner tools
1. Partner Intelligence contract + service (foundation)
2. Zone Recommendations            ← moved BEFORE Copilot: it produces the richest signal the
                                      Copilot must explain, and reuses existing zoneScoring
3. Earnings Coach                  ← depends on D1 resolution
4. Partner Copilot                 ← consumes 1-3; enabling tools is the last step, not the first
5. Smart Shift Planning
6. Performance Nudges              ← depends on D2 resolution
7. Morning Intelligence            ← automation; depends on 2,3,5,6 for content
8. Surge Automation                ← automation; extends existing surge, adds alert
9. Explainable Insights            ← cross-cutting, enforced from step 1, audited at the end
10. Admin oversight
11. Final reconciliation
```

**Why Zone Recommendations moves ahead of Copilot:** the brief's default order lists Copilot second,
but the Copilot's value is explaining computed signals. Building it before the signals exist would
mean either an empty copilot or an LLM inventing facts — the exact failure mode the brief forbids.

## 5. Reusable services (extend, never duplicate)

`geoIntelligenceService` (demand/surge/density/zoneScoring) · `weatherService` ·
`partnerOsService` · `partnerOperationsService` · `providerService` · route optimisation at
`/me/route/optimize` · `invokeAiGateway` · tool registry/policy/audit · `feature-flag.service` ·
`routeNotification` + governance · workflow registry + `certifyAutomation` ·
`runWithLeaderLock` · event outbox · `cacheService` · `observability` / Prometheus helpers ·
Partner Map (P1-2) · admin `ui/` primitives + `GlassPanel`/`PageShell` · `rbac.service`.

**No V2 of anything.** No new AI engine, ML engine, notification engine, map stack, or certification
framework.

## 6. Files likely to change

**New (backend)**
- `src/services/partner-intelligence.service.ts` — the one new service (contract assembly, zone
  opportunity, earnings coaching, shift windows, nudges).
- `src/services/partner-intelligence.types.ts` — the bounded contract + freshness/confidence types.
- `src/routes/partner-intelligence.routes.ts` — partner-facing endpoints.
- `src/automation/registry/definitions/partner-intelligence-workflows.ts` — morning brief + surge
  alert workflow definitions.
- `src/notifications/templates/` additions — partner briefing / surge / nudge templates.
- `src/__tests__/partner-intelligence-*.test.ts` — capability tests.

**Modified (backend)**
- `src/ai-brain/context/collectors/partner-context.ts` — enrich (bounded, minimum-PII).
- `src/routes/ai-gateway.routes.ts` — enable READ-only tools on the partner surface, flag-gated.
- `src/ai-tools/registry/tool-catalog.ts` + `execution/handlers/index.ts` — add only genuinely new
  READ tools; fix D2 mislabeling.
- `src/services/partner-os.service.ts` — resolve D1.
- `src/lib/maintenance.ts` — register the morning tick via `runWithLeaderLock`.

**Mobile / web / admin** — partner mobile screens under `homigo-partner-mobile/src/screens/`,
partner web `/(partner)/intelligence` extension, one admin console page.

## 7. DB impact and migration plan

**Deliberately minimal. No schema migration is planned for capabilities 1-6.**

- Feature flags are **rows** in the existing flag table — data, not schema.
- Notification templates are seeded through the existing registry upsert — data, not schema.
- Recommendations are **computed on read**, not persisted, in the first cut. Persisting them would
  add a table and a retention obligation for partner location/earnings data; it is not required for
  any capability and is deliberately avoided.
- Shadow evidence uses the **existing** notification shadow-evidence tables.

If persistence later proves necessary, it will be raised as `HUMAN_DECISION_REQUIRED` with a
migration authored and verified on a test database — **never applied to `homigo_db`** without
explicit approval, consistent with the four migrations already queued from Phase 8.

## 8. APIs (server-authoritative; UI computes nothing)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/providers/me/intel/context` | The full bounded `PartnerIntelligenceContext` |
| GET | `/api/providers/me/intel/zones` | Ranked zone opportunities with reasons |
| GET | `/api/providers/me/intel/earnings-coach` | Target-aware earnings guidance |
| GET | `/api/providers/me/intel/shift-plan` | Recommended windows (advisory only) |
| GET | `/api/providers/me/intel/nudges` | Performance nudges or `INSUFFICIENT_HISTORY` |
| POST | `/api/ai/partner` | **existing** — copilot, extended with context + READ tools |

All resolve `providerId` from the authenticated actor. No identity is ever read from query, body or
tool arguments.

## 9. Freshness and confidence model

Every fact in the contract carries `{ value, source, timestamp, freshness, confidence? }` with
`freshness ∈ REAL_TIME | NEAR_REAL_TIME | HISTORICAL | FORECAST | STATIC | UNKNOWN`.

Explicit absence states — never a fake default:
`MODEL_UNAVAILABLE` (BigQuery/`intel()` threw) · `INSUFFICIENT_HISTORY` (below sample-size floor) ·
`LOCATION_STALE` / `LOCATION_UNAVAILABLE` · `WEATHER_UNAVAILABLE` · `ROUTE_UNAVAILABLE`.

`intel()` throws rather than degrading, so the partner intelligence service **must** catch per-signal
and degrade the contract, not the request.

## 10. Security model

- Identity server-derived from `actor.actorId` → `resolveProviderId`, never from arguments.
- Partner tools stay READ-only on the partner surface (`allowWrites: false`), mirroring the customer
  path.
- Existing tool policy, approval gate, audit and circuit breaker unchanged.
- LLM is never authorization and never a source of facts.
- Minimum-PII to the LLM: coarse zone/location, aggregates not raw ledgers; no OTP, tokens,
  credentials, or raw location history.
- Test matrix: customer→partner tool denial, partner A→partner B IDOR, actorId/role spoofing,
  `admin:true` / `allUsers:true` / `confirmed:true` injection, forged approvalId, prompt injection,
  and leakage checks for location/earnings/payout/jobs/performance.

## 11. Feature flags — 7 keys, all default OFF, fail-closed

`PARTNER_COPILOT` · `PARTNER_ZONE_RECOMMENDATIONS` · `PARTNER_EARNINGS_COACH` ·
`PARTNER_SHIFT_PLANNING` · `PARTNER_PERFORMANCE_NUDGES` · `PARTNER_MORNING_INTELLIGENCE` ·
`PARTNER_SURGE_ALERTS`

Created through the existing service (rows + existing cache invalidation). No new flag mechanism.

## 12. Automation and certification plan

**Only two capabilities are automations:** Morning Intelligence and Surge Alerts. They get workflow
definitions, run through `routeNotification` (never a direct push adapter), and are certified via
`certifyAutomation` — which defaults to `SHADOW` and requires a real human approver.

**The other six are request-response capabilities, not workflows.** Per the brief's explicit
instruction not to pretend every intelligence feature is a workflow, they are gated by feature flags
(default OFF, fail-closed) and evidenced by real-data observation, not by automation certification.

**No self-certification. No LIVE activation.** LIVE remains blocked pending separate approval.

## 13. Real observation plan

Real partner, real data, real signals — no fabricated history, earnings, demand, weather, GPS or
jobs. Observations run **read-only against `homigo_db`** where the capability is read-only
(capabilities 1-6 compute on read and mutate nothing), and any automation observation runs in
**SHADOW** on the isolated `homigo_p39` database established in Phase-8 P3-9.

Side-effect sentinels captured before/after every observation: bookings, assignments, payments,
wallet, ledger, notifications, NotificationDelivery, outbox, workflow instances, scheduled jobs.
Expected deltas documented; anything else is a finding.

Push delivery without a device is reported as `SERVER_SIDE_OBSERVED` /
`PHYSICAL_DELIVERY_NOT_VERIFIED`.

## 14. Risks

| Risk | Mitigation |
|---|---|
| LLM restating ungrounded numbers | Fix D1 before enabling tools; every fact carries source + confidence |
| Partner PII reaching the LLM | Minimum-fact projection; coarse location; aggregates only |
| BigQuery outage silently degrading advice | `intel()` throws → explicit `MODEL_UNAVAILABLE`, never a default |
| Notification fatigue | Existing cadence/cooldown/quiet-hours; SHADOW first |
| Duplicate zone scoring | Reuse `zoneScoring()`; add a partner-opportunity layer on top |
| Copilot latency (context + tools + LLM) | Reuse `cacheService`; measure, no fake benchmarks |
| Surge oscillation | Extend existing deterministic surge with hysteresis + cooldown; no second engine |

## 15. Blockers

| Item | Classification |
|---|---|
| D1 — business basis for `*1.05` / `*1.08` (ground, relabel, or remove) | `HUMAN_DECISION_REQUIRED` — proceeding with **remove-or-relabel** as the safe default, reversible |
| Morning brief cadence + notification budget | `HUMAN_DECISION_REQUIRED` — SHADOW only until decided |
| Minimum sample size for nudges | `HUMAN_DECISION_REQUIRED` — proceeding with a conservative documented floor |
| LIVE activation of any capability | `HUMAN_DECISION_REQUIRED` — remains blocked |
| Physical device for push verification | `EXTERNAL_ARTIFACT_REQUIRED` |

None of these blocks the foundation work, so the loop continues.

## 16. First implementation item

**Item 0 — resolve D1 and D2**, because both corrupt everything downstream and both are small:

- **D1:** investigate whether any business or model basis exists for `*1.05` / `*1.08`. If none is
  found in code, docs or history, stop presenting them as projections — relabel as non-predictive
  arithmetic or remove — and give the endpoint an honest confidence/source.
- **D2:** make `read.partner.getPartnerPerformance` return real performance metrics, or rename it to
  match what it returns, so the copilot cannot state retention numbers as performance.

Then **Item 1 — the `PartnerIntelligenceContext` contract + `partner-intelligence.service.ts`**,
which every later capability consumes.

Regression after each item: backend typecheck, backend tests, partner mobile typecheck, security
suites, Phase-7 and Phase-8 critical. No suppression, no weakened assertions, no CI bypass.
