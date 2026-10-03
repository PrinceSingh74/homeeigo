# PARTNER INTELLIGENCE — IMPLEMENTATION AUDIT (read-only)

**Scope:** Partner Copilot · Morning Intelligence · Surge Automation · Earnings Coach ·
Smart Shift Planning · Performance Nudges · Zone Recommendations · Explainable Insights.

**Method:** fresh read-only inspection of the live repository. No code written. No assumption that
any capability is complete. Every claim below cites what was actually read.

**Headline:** the *substrate* for Partner Intelligence is real and largely production-grade —
geo-intelligence, demand forecasting, weather, earnings, route optimisation, ratings, an AI gateway
with a partner endpoint, 6 partner READ tools, and a governed notification stack. The *capabilities*
themselves are largely not built on top of it. **0 of 8 are COMPLETE.**

---

## Matrix

| Capability | Status |
|---|---|
| 1. Partner Copilot | `PARTIAL` |
| 2. Morning Intelligence | `MISSING` |
| 3. Surge Automation | `PARTIAL` |
| 4. Earnings Coach | `PARTIAL` |
| 5. Smart Shift Planning | `MISSING` |
| 6. Performance Nudges | `MISSING` |
| 7. Zone Recommendations | `PARTIAL` |
| 8. Explainable Insights | `PARTIAL` |

### Per-capability dimension matrix

Legend: `C` COMPLETE · `P` PARTIAL · `M` MISSING · `n/a` not applicable

| Capability | Impl | Tests | Real data | Real obs. | Shadow | Cert | Flag | Mobile | Web | Admin | Security | Side-effects | Perf |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Partner Copilot | P | M | P | M | M | M | M | P | C | M | C | C | M |
| Morning Intelligence | M | M | M | M | M | M | M | M | M | M | n/a | n/a | M |
| Surge Automation | P | P | C | P | M | M | M | C | C | P | C | C | P |
| Earnings Coach | P | P | C | M | M | M | M | C | P | M | C | C | P |
| Smart Shift Planning | M | M | n/a | M | M | M | M | M | M | M | n/a | n/a | M |
| Performance Nudges | M | M | n/a | M | M | M | M | M | M | M | n/a | n/a | M |
| Zone Recommendations | P | P | C | P | M | M | M | C | C | P | C | C | P |
| Explainable Insights | P | M | C | M | M | M | M | P | P | M | n/a | n/a | n/a |

**Cross-cutting gaps that apply to all eight:** no feature flag, no shadow mode, no certification,
and no test covering any named capability (only substrate tests exist).

---

## 1. Partner Copilot — `PARTIAL`

**The pipe exists. The intelligence does not flow through it.**

What is real:

- `POST /api/ai/partner` exists (`ai-gateway.routes.ts:97`) and calls
  `handleGatewayRequest(request, userId, role, "partner", body, set)` → `invokeAiGateway`.
- RBAC is enforced by the security module's own `mapUserRoleToAiRole(userRole, "partner")`; an
  unmapped role returns 403.
- A partner UI exists: `apps/partner-web/src/components/ai/PartnerAiPanel.tsx` (244 lines) posting
  to `/api/ai/partner` via `partnerApi.aiChat`, surfaced at `/(partner)/ai`.
- A partner context collector exists: `src/ai-brain/context/collectors/partner-context.ts`.
- Six partner READ tools exist in the catalog: `getPartnerDemand`, `getPartnerEarnings`,
  `getPartnerJobs`, `getPartnerPerformance`, `getPartnerProfile`, `getPartnerSchedule`.
- All gateway security controls apply (prompt-injection screening, output validation, audit, cost).

**Where the required path breaks — two independent breaks:**

**Break 1 — the partner context carries almost no intelligence.** `partner-context.ts` is 73 lines
and gathers exactly five facts: the provider record, today's job count, active jobs, an aggregate of
today's earnings, and a pending-document count. It contains **no demand, no surge, no weather, no
location or zone, no route, no performance metrics and no forecast**. The audit's required chain
"→ demand/location/surge/weather/jobs/earnings/route/performance → structured facts" is therefore
not satisfied: those signals do not reach the runtime path.

**Break 2 — tools are switched off on the partner surface.** The gateway *can* run tool
conversations (`runToolConversation`, imported at `ai-gateway.ts:21`), but only when the caller
passes `options.tools.enabled`. `handleGatewayRequest` passes **no `tools` option at all**. The only
production caller that enables tools is the CUSTOMER chat path (`routes/ai.ts:110`,
`allowWrites: false`). So the six partner READ tools are unreachable from the partner copilot; they
can only be invoked directly through `/api/ai/tools/execute`.

**Also missing:** there is no structured "explainable action plan" output contract — the endpoint
returns `{ content, provider, model, fallbackUsed, requestId }`, i.e. free text.

No fabricated data was found on this path.

## 2. Morning Intelligence — `MISSING`

Not implemented in any form.

- The scheduler (`src/lib/maintenance.ts`) registers **17** timers: locationRetention, otp,
  reconcile, backup, deletion, assignment, financeReconcile, integrity, settlementSync, alertEval,
  opsAlertDispatch, archival, tokenCleanup, retentionTick, refundRetry, aiBrainMaintenance,
  incentiveEval. **None is a morning or daily briefing.**
- No `morningBrief`, `dailyBrief`, `dailyDigest`, `partnerBrief` or `briefing` symbol exists
  anywhere in the backend.
- The governed notification template registry contains only customer-facing templates
  (`booking.follow_up_checkin.*`, `booking.review_request.*`, `checkout.recovery_nudge.*`,
  `payment.recovery_nudge.*`). **There is no partner briefing template.**

Per the audit instruction, the existence of partner push infrastructure (delivered in Phase-8 P1-1)
is explicitly **not** counted as Morning Intelligence. The transport exists; the capability does not.

## 3. Surge Automation — `PARTIAL`

**The governance constraint is satisfied. The automation and the alert are absent.**

What is real:

- Surge is computed **deterministically** in `booking-pricing.service.ts`,
  `dynamic-pricing.service.ts`, `geo-intelligence.service.ts`, `geofence.service.ts`,
  `digital-twin.service.ts` and `platform-intelligence.service.ts`.
- **The LLM does not decide surge.** A search of `src/ai/`, `src/ai-brain/` and `src/ai-tools/`
  found no surge computation; the only occurrence in any AI module is an unrelated admin-facing
  dispatch-rebalancing prompt template. **Constraint verified.**
- Supply-side data exists (`provider-density`, zone scoring) and both partner web and partner mobile
  already read `/api/geo-intel/surge`.

What is missing:

- **No automation workflow.** The registered workflows are engine self-test, payment recovery,
  checkout recovery, review request, follow-up, and seven partner *acquisition* workflows. There is
  no surge workflow.
- **No alert.** Surge does not appear anywhere in `src/notifications/`, and there is no partner
  surge notification template.

So `demand + supply → deterministic rule` is present; `→ automation → alert` is not.

## 4. Earnings Coach — `PARTIAL`

What is real:

- Earnings come from real partner data: `/api/providers/me/earnings`,
  `providerService.myEarningsSummary(providerId, 30)`, `prisma.earning` aggregates.
- `/api/providers/me/forecast` (`partnerOsService.getForecast`) composes real dashboard earnings,
  the real 30-day earnings summary, and the real `geoIntelligenceService.demandForecast(24)`.
- It returns an `inputs` block, which is a partial form of explainability.
- **No guaranteed-income language.** A repo-wide search across partner web, partner mobile and the
  backend for "guaranteed / assured income / promised earnings / you will earn" returned **no
  matches**. Constraint verified.

What is missing or questionable:

- **There is no coaching.** No advice, no goal, no gap analysis, no recommended action is generated
  anywhere — the capability is a projection endpoint, not a coach.
- **`FINDING — unfounded growth multipliers.** `getForecast` computes
  `weeklyProjection = weekEarnings * 1.05` and `monthlyProjection = monthEarnings * 1.08`. These
  5% and 8% growth factors are hardcoded with no stated basis, no model and no confidence, yet are
  presented to partners as projections. This is the closest thing to a fabricated trend found in
  this audit and should be either grounded or removed.
- The `/(partner)/ai-hq/earnings-coach` page is a **7-line redirect stub** to `/intelligence` — not
  an implementation.

## 5. Smart Shift Planning — `MISSING`

- No shift-recommendation engine exists. No symbol matching `shiftPlan` / `ShiftPlan` /
  `smart shift` exists anywhere in the repository.
- Inputs that *would* ground it exist independently (demand forecast, geo-intel zones, weather
  service, route optimisation at `/api/providers/me/route/optimize`, historical performance via
  `/me/rankings` and `partner-operations.service`), but nothing consumes them for shift planning.
- **The safety constraint is satisfied by absence:** nothing automatically modifies partner
  availability. Availability changes run through the partner-controlled FSM
  (`partner-availability-fsm.test.ts`, `write.partner.updateAvailability` — an explicit partner
  action). No scheduler or AI path writes availability.

## 6. Performance Nudges — `MISSING`

- No nudge generation for partner performance exists.
- Real performance data is available: `/api/providers/me/rankings` (`partnerOsService.getRankings`)
  computes genuine city-peer comparison over `rating`, `completionRate`, `acceptanceRate`;
  `/me/intelligence` returns real repeat-customer rates.
- **No sample-size gating exists**, because there is nothing to gate — this must be built in when
  the capability is, since peer percentiles on a handful of jobs would be misleading.
- `PARTNER_ONBOARDING_NUDGE` exists but is an **acquisition/onboarding reminder**, not a performance
  nudge. It must not be counted toward this capability.
- No governed notification template for performance feedback exists.

## 7. Zone Recommendations — `PARTIAL`

**The strongest of the eight.**

What is real:

- `/api/geo-intel/*` provides `surge`, `provider-density`, `zone-scoring` and `demand-forecast` from
  real data.
- Partner web consumes them through `use-partner-intelligence.ts`, which composes surge + density +
  zone scoring + a 6-hour demand forecast into a `SmartZone[]` on a 60-second refetch, combined with
  live geolocation (`use-geolocation-watcher`), rendered at `/(partner)/intelligence` (151 lines).
- Partner mobile calls the same four endpoints plus `/api/providers/me/*`.
- `/api/providers/me/service-area/zones` provides the partner's own zones.

What is missing:

- **Weather and route are not part of the recommendation.** A weather service exists
  (`/api/weather`) and route optimisation exists (`/me/route/optimize`), but neither is an input to
  zone scoring or to the `SmartZone` composition.
- **No traceable per-recommendation reasons.** The audit requires every recommendation to carry its
  reasons; `SmartZone` carries scores, not a reason list.
- Job density is represented indirectly (demand forecast + provider density) rather than as an
  explicit job-density signal.

## 8. Explainable Insights — `PARTIAL`

Against the six required attributes:

| Attribute | Status | Evidence |
|---|---|---|
| signal | `PARTIAL` | geo-intel responses carry `source` (13 occurrences) |
| source | `COMPLETE` | as above |
| timestamp | `PARTIAL` | `generatedAt` (3) and `freshness` (12) on geo-intel; not on partner-facing composites |
| rules/model version | `MISSING` | no `modelVersion` or `rulesVersion` on any partner-facing response |
| confidence | `PARTIAL` | `confidence` (14) on geo-intel; absent from `getForecast`, `SmartZone`, rankings |
| reason | `MISSING` | no recommendation anywhere carries a reasons array |

A model registry does exist (`/api/mlops/*`, BigQuery `model_registry`), so version stamping is
achievable — it simply is not wired into partner-facing responses.

---

## Cross-cutting findings

**Naming is misleading in two places, and both would cause an audit to over-credit the scope:**

1. `/api/providers/me/intelligence` is **not** partner intelligence. It returns only
   `uniqueCustomers`, `returningCustomers` and `repeatCustomerRatePct` — a real, correctly computed
   customer-retention metric, but not recommendations.
2. `/(partner)/ai-hq/earnings-coach` is a 7-line redirect, and `/(partner)/ai-hq/*` contains only
   three pages (demand-forecast, earnings-coach, route-optimization).

**There is no `partner-intelligence.service.ts` and no partner AI service.** Twelve `*-intelligence`
services exist (customer, eta, finance, geo, growth, maintenance, platform, rebooking, recovery,
risk, satisfaction, vision) — none for partner. The customer domain has both `customer-ai.service`
and `customer-intelligence.service`; the partner domain has neither.

**Tests:** substrate tests exist and pass (`demand-forecast`, `eta-intelligence`,
`partner-operations.integration`, `partner-availability-fsm`, `partner-incentive-payout`). **No test
covers any of the eight named capabilities.**

**Shadow mode:** exists only inside the automation engine's notification step
(`executionMode: "LIVE" | "SHADOW"`). It is not applied to any partner intelligence path.

**Certification:** no partner-intelligence certification document exists.

**Feature flags:** no flag gates any partner intelligence capability.

**Admin:** the console has `ai`, `ai-brain`, `command-center`, `digital-twin`, `eta-intelligence`,
`heatmap`, `weather`, `geospatial` and `vendors`, but **no partner-intelligence oversight screen** —
no way for an operator to review, tune or audit partner recommendations.

**Security (positive):** the partner AI path enforces RBAC through the security module's own role
mapper, and the Phase-8 P3-9 audit already proved the tool layer denies cross-role access, IDOR,
`actorId` spoofing and injected privilege claims. Nothing in this audit found a partner-intelligence
security weakness — largely because so little is built.

**Side effects (positive):** no partner intelligence path mutates partner state. Availability is
changed only by explicit partner action.

**Performance:** partner web polls four geo-intel endpoints on a 60-second interval per session.
That is fine at current scale but is an unmeasured cost with no caching evidence at the partner tier
— flagged, not measured, because this audit is read-only.

---

## What would have to be true for this scope to be COMPLETE

1. Partner context enriched with demand, surge, weather, location/zone, route, jobs, earnings and
   performance — and proven to reach the runtime path.
2. Tools enabled on the partner gateway surface (read-only first), so the copilot can actually
   consult the six partner READ tools.
3. A structured, explainable action-plan output contract rather than free text.
4. A scheduled morning briefing job feeding governed partner notification templates.
5. A deterministic surge automation workflow with a partner alert.
6. Coaching logic over real earnings, with the 1.05/1.08 multipliers grounded or removed.
7. A shift planner grounded in demand + location + weather + route + history, recommending only.
8. Performance nudges with explicit sample-size gating.
9. Weather, route and explicit job density added to zone recommendations, each with reasons.
10. `reasons`, `confidence`, `modelVersion`/`rulesVersion` and `timestamp` on every recommendation.
11. Tests, shadow-mode rollout, feature flags, an admin oversight surface, and certification.

**No code was written. No file was modified. This audit is read-only.**
