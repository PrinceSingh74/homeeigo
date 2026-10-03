# PARTNER INTELLIGENCE — WORK MANIFEST

| Item | Status | Evidence |
|---|---|---|
| Discovery / audit | `COMPLETE` | `PARTNER_INTELLIGENCE_AUDIT.md` — 0 of 8 capabilities complete |
| Implementation plan | `COMPLETE` | `PARTNER_INTELLIGENCE_IMPLEMENTATION_PLAN.md` |
| **Item 0 — D1 growth multipliers** | `COMPLETE` | Removed; trailing actuals + `basis`; real-data verified |
| **Item 0 — D2 performance tool** | `COMPLETE` | `getPerformanceSummary` added; tool rebound; real-data verified |
| **P3-10 outbox guard regression** | `COMPLETE` (self-caught, fixed) | `partner-operations.integration` 2/5 → 7/0 |
| Item 1 — Intelligence contract + service | `COMPLETE` | 32/32 on isolated DB; 9 signals; real-data verified |
| Capability 7 — Zone Recommendations | `COMPLETE` (flag OFF) | zone.rules.v1; 17/17; real observation; zero side effects |
| Capability 4 — Earnings Coach | `COMPLETE` (flag OFF) | coach.rules.v1; 26/26; 9/9 spoofing denied; side effects 0 |
| Capability 5 — Smart Shift Planning | `COMPLETE` (flag OFF) | shift.rules.v1; 22/22; advisory proven structurally; side effects 0 |
| Capability 6 — Performance Nudges | `COMPLETE` (flag OFF) | nudge.rules.v1; 24/24, 125 assertions; 8/8 spoofing denied; side effects 0 |
| Capability 2 — Morning Intelligence | `NEXT` | automation: workflow + SHADOW certification |
| Capabilities 1, 3, 8 | `NOT STARTED` | see plan §4 |

## Files changed (Item 0)

| File | Change |
|---|---|
| `src/services/partner-os.service.ts` | D1 fix; added `getPerformanceSummary` |
| `src/ai-tools/execution/handlers/index.ts` | D2 — rebound `getPartnerPerformance` |
| `src/lib/json-input.ts` | corrected over-strict guard to serialisation truth |
| `src/__tests__/partner-intel-earnings-basis.test.ts` | new, 11 tests |
| `src/__tests__/p3-8-json-input.test.ts` | corrected assertions that encoded a wrong belief |

## Standing state

- Feature flags created: **none yet** (7 planned, all default OFF)
- DB migrations: **none** — no schema change planned for capabilities 1–6
- Certifications: **none** — LIVE remains blocked
- `homigo_db`: **read-only**, unmutated
- HIGH_RISK AI tools: **0/14 bound**, Phase-5 freeze intact

## Files changed (Item 1)

| File | Change |
|---|---|
| `src/services/partner-intelligence.types.ts` | new — the canonical contract |
| `src/services/partner-intelligence.service.ts` | new — signal aggregation only, no ranking |
| `src/__tests__/partner-intelligence-context.integration.test.ts` | new, 32 tests, isolated DB only |

## Known gaps carried into Zone Recommendations

- Route/travel time is not yet a context signal (straight-line `distanceKm` only).
- `zoneCandidates` are unranked by design.
- No feature flags created yet; no route exposes the context yet.

## Files changed (Item 2)

| File | Change |
|---|---|
| `src/services/zone-recommendation.service.ts` | new — deterministic ranking, `zone.rules.v1` |
| `src/routes/providers.ts` | added `GET /me/intel/zones`, flag-gated, fail-closed |
| `src/__tests__/zone-recommendation.integration.test.ts` | new, 17 tests, isolated DB only |

## Feature flags

| Key | State |
|---|---|
| `PARTNER_ZONE_RECOMMENDATIONS` | referenced by the route; **row deliberately not created** — absent means OFF and the endpoint 404s |

## Files changed (Item 3)

| File | Change |
|---|---|
| `src/services/earnings-coach.service.ts` | new — deterministic opportunity plan, `coach.rules.v1` |
| `src/routes/providers.ts` | added `GET /me/intel/earnings-coach`, flag-gated, fail-closed |
| `src/ai-tools/registry/tool-catalog.ts` | added `read.partner.getEarningsOpportunity` (READ, LOW) |
| `src/ai-tools/execution/handlers/index.ts` | bound that tool to the coach |
| `src/__tests__/earnings-coach.integration.test.ts` | new, 26 tests, isolated DB only |

## Feature flags

| Key | State |
|---|---|
| `PARTNER_ZONE_RECOMMENDATIONS` | row NOT created in `homigo_db` — absent = OFF, endpoint 404s |
| `PARTNER_EARNINGS_COACH` | row NOT created in `homigo_db` — enabled only inside `homigo_p39` |

## AI tool catalog

56 tools — 30 READ / 12 WRITE / 14 HIGH_RISK. **HIGH_RISK 0/14 bound** (re-verified).

## Files changed (Item 4)

| File | Change |
|---|---|
| `src/services/shift-planning.service.ts` | new — advisory planner, `shift.rules.v1`, holds no DB handle |
| `src/routes/providers.ts` | added `GET /me/intel/shift-plan`, flag-gated, fail-closed |
| `src/__tests__/shift-planning.integration.test.ts` | new, 22 tests incl. structural no-write proof |

## Feature flags (none enabled in homigo_db)

| Key | State |
|---|---|
| `PARTNER_ZONE_RECOMMENDATIONS` | row NOT created — absent = OFF |
| `PARTNER_EARNINGS_COACH` | row NOT created — enabled only inside `homigo_p39` |
| `PARTNER_SHIFT_PLANNING` | row NOT created — absent = OFF |

## Post-phase follow-ups raised

| Item | Detail |
|---|---|
| Demand model retraining | ARIMA horizon starts 68 days in the past; hourly spread 0.010; cannot inform timing |

## Files changed (Item 5)

| File | Change |
|---|---|
| `src/services/performance-nudges.service.ts` | new — event-sourced metrics, `nudge.rules.v1` |
| `src/routes/providers.ts` | added `GET /me/intel/nudges`, flag-gated, fail-closed |
| `src/ai-tools/registry/tool-catalog.ts` | added `read.partner.getPerformanceNudges` (READ, LOW, no params) |
| `src/ai-tools/execution/handlers/index.ts` | bound that tool |
| `src/__tests__/performance-nudges.integration.test.ts` | new, 24 tests / 125 assertions |

## Feature flags (none enabled in homigo_db — verified 0 PARTNER_* rows)

| Key | State |
|---|---|
| `PARTNER_ZONE_RECOMMENDATIONS` | row NOT created — absent = OFF |
| `PARTNER_EARNINGS_COACH` | row NOT created — enabled only inside `homigo_p39` |
| `PARTNER_SHIFT_PLANNING` | row NOT created — absent = OFF |
| `PARTNER_PERFORMANCE_NUDGES` | row NOT created — enabled only inside `homigo_p39` |
| `PARTNER_MORNING_INTELLIGENCE` | row NOT created — name reserved, not yet wired to a gate (Item 6 has no request-response surface) |
| `PARTNER_SURGE_ALERTS` | row NOT created — name reserved, off-state asserted; Item 7 has no request-response surface either |
| `PARTNER_EXPLAINABLE_INSIGHTS` | row NOT created — name reserved, off-state asserted |

## AI tool catalog

57 tools — 31 READ / 12 WRITE / 14 HIGH_RISK. **HIGH_RISK 0/14 bound** (re-verified after each change).

## Post-phase follow-ups raised

| Item | Detail |
|---|---|
| Demand model retraining | ARIMA horizon starts 68 days in the past; hourly spread 0.010 |
| Unmaintained provider counters | `completionRate`, `cancellationRate`, `responseRate`, `avgResponseTime`, `avgCompletionTime` have no writer; 160/173 providers hold 0. Nudges bypass them, but admin surfaces still display them |


## Item 6 — Morning Intelligence

**Status:** implementation COMPLETE · schedule `HUMAN_DECISION_REQUIRED` · certification `NOT_READY`
· LIVE blocked · real scheduled observation `BLOCKED_BY_BUSINESS_SCHEDULE`

| Artifact | Path |
|---|---|
| Schedule boundary (UNSET) | `apps/backend/src/services/morning-schedule.config.ts` |
| Brief contract | `apps/backend/src/services/morning-intelligence.types.ts` |
| Brief assembler | `apps/backend/src/services/morning-intelligence.service.ts` |
| Workflow `morning_intelligence.v1` | `apps/backend/src/automation/registry/definitions/morning-intelligence-workflow.ts` |
| Tests (49 / 177 assertions) | `apps/backend/src/__tests__/morning-intelligence.integration.test.ts` |

**Modified (additive only):** `trigger-registry.ts`, `condition-registry.ts`, `provider.resolver.ts`,
`templates/definitions.ts`, `channel-policy.ts`, `containment.ts`, `event-types.ts`,
`definitions/index.ts`, `shift-planning.service.ts` (exported `isDemandForecastStale`, delegating).

**Workflow:** `morning_intelligence` v1 · trigger `homigo.partner.morning_intelligence.due` (published
by nothing) · subject `provider` · SHADOW / DRAFT / LOW · CONDITION → NOTIFICATION → STOP ·
`maxAgeMs` 18 h.

**Eligibility:** `provider.morning_eligible` — the six dispatch clauses from `matching.service.ts`,
stated individually so drift is visible.

**Notification:** `partner.morning_intelligence`, PUSH + IN_APP (EMAIL excluded), variables
`partnerName` / `topZoneName` / `windowLabel` / `nudgeCount` — all structured facts, no free text.

**Evidence:** 3 real partners, read-only, zero mutation across 9 counters; one real defect found and
fixed (demand OK/STALE contradiction) with one shared `isDemandForecastStale` definition.

**Blocked on:** a business decision for the morning local time. Explicitly *not* 08:00 — that is the
quiet-hours boundary, and a guard test refuses a schedule derived from it.


## Item 7 — Surge Automation

**Status:** implementation COMPLETE · policy `HUMAN_DECISION_REQUIRED` · trigger semantics
`ARCHITECTURAL_GAP` · real surge observation `REAL_SURGE_OBSERVATION_PENDING` · certification
`NOT_READY` · LIVE blocked

| Artifact | Path |
|---|---|
| Policy boundary (UNSET) | `apps/backend/src/services/surge-alert-policy.config.ts` |
| Signal reader + evaluator | `apps/backend/src/services/surge-alert.service.ts` |
| Workflow `surge_alert.v1` | `apps/backend/src/automation/registry/definitions/surge-alert-workflow.ts` |
| Tests (41 / 174 assertions) | `apps/backend/src/__tests__/surge-alert.integration.test.ts` |

**Authoritative source:** `geoIntelligenceService.surgePrediction()` — deterministic, per-zone,
120 s cached. Never recomputed, smoothed or corrected here.

**Money boundary:** only `weatherService.surgeMultiplier()` reaches `chargeableBase`. The alert is
built on `predictedSurge`, which reaches nothing, so the template carries no multiplier and no
earnings claim.

**Zone identity:** `zoneId` everywhere; `zoneName` is a display label (two active zones share one).

**Anomalies surfaced:** `ZERO_SUPPLY_SIGNAL_ANOMALY`, `SIGNAL_SATURATED`, `DUPLICATE_ZONE_NAME`.

**Workflow:** `surge_alert` v1 · trigger `homigo.partner.zone_surge.detected` (published by nothing)
· subject `provider` · SHADOW / DRAFT / LOW · CONDITION -> NOTIFICATION -> STOP · `maxAgeMs` 12 h
(registry floor: must outlive the 11 h quiet window).

**Eligibility:** reuses `provider.morning_eligible` — no second definition.

**Human decisions:** threshold, hysteresis, alert cooldown, trigger event semantics, and whether to
correct the zero-supply discontinuity in the source formula.


## Item 8 — Explainable Insights

**Status:** COMPLETE · certification not applicable (not a workflow) · no existing file modified

| Artifact | Path |
|---|---|
| Canonical contract | `apps/backend/src/services/partner-insight-evidence.types.ts` |
| Six adapters | `apps/backend/src/services/partner-insight-explainer.service.ts` |
| Tests (29 / 278 assertions) | `apps/backend/src/__tests__/explainable-insights.integration.test.ts` |

**Design:** projection over five pre-existing reason shapes (`ZoneReason`, `CoachReason`,
`ShiftReason`, `MetricEvidence`, `ZoneSurgeDecision`). Items 0-7 unchanged. A test asserts the
explainer contains no arithmetic, so it cannot compute a score, rank or amount.

**Scope guard:** `insightScope()` derives PARTNER_SPECIFIC / ZONE_SPECIFIC / PLATFORM_WIDE from
evidence that actually contributed. Verified live: a zone ranked with no usable partner evidence
returns `ZONE_RANKING_PLATFORM_ONLY` and refuses to call itself personal.

**LLM:** absent from the path entirely. Deterministic explanation is the only explanation.

**Negative tests:** changing prose leaves evidence untouched; removing evidence degrades
GROUNDED to INCOMPLETE to UNAVAILABLE without substitution.

**Defect found and fixed (mine):** morning-brief adapter put the signal's name where a measurement
belonged; brief-level evidence now reports availability and freshness with `value: null`.

**Not built:** partner-facing "Why this?" UI — `POST_PHASE_FOLLOWUP`.
