# PARTNER INTELLIGENCE — STATE

**Cycle:** implementation in progress (Item 0 complete; see the implementation log at the end).
**Verdict: `SCOPE_NOT_COMPLETE` — 0 of 8 capabilities are COMPLETE.**

The capability table below is the DISCOVERY baseline and is intentionally left as-recorded; the
implementation log at the end of this file is the current state.

Evidence and per-dimension detail: `PARTNER_INTELLIGENCE_AUDIT.md`.

---

## Capability state

| # | Capability | Status | One-line reason |
|---|---|---|---|
| 1 | Partner Copilot | `PARTIAL` | Endpoint + UI + RBAC real, but partner context carries 5 basic facts and tools are disabled on the partner surface |
| 2 | Morning Intelligence | `MISSING` | None of the 17 scheduled jobs is a briefing; no briefing code, no partner template |
| 3 | Surge Automation | `PARTIAL` | Deterministic surge is real and LLM-free; no automation workflow and no partner alert |
| 4 | Earnings Coach | `PARTIAL` | Real earnings + real demand feed a projection; no coaching, and growth multipliers are unfounded |
| 5 | Smart Shift Planning | `MISSING` | No planner exists; inputs exist but nothing consumes them |
| 6 | Performance Nudges | `MISSING` | Real ranking data exists; no nudge generation and no sample-size gating |
| 7 | Zone Recommendations | `PARTIAL` | Real surge/density/zone/demand consumed by web + mobile; no weather, route or reasons |
| 8 | Explainable Insights | `PARTIAL` | source/confidence/freshness on geo-intel; no reasons, no model/rules version |

## Cross-cutting state

| Dimension | Status |
|---|---|
| Tests for named capabilities | `MISSING` (substrate tests exist and pass) |
| Real data | `COMPLETE` for the substrate; no fabricated data found on any runtime path |
| Real observation | `PARTIAL` (geo-intel telemetry only) |
| Shadow mode | `MISSING` for partner intelligence (exists only in the automation notification step) |
| Certification | `MISSING` |
| Feature flags | `MISSING` |
| Mobile | `PARTIAL` (consumes geo-intel + provider endpoints; no capability UI) |
| Web | `PARTIAL` (real hubs over real data; `ai-hq/earnings-coach` is a redirect stub) |
| Admin | `MISSING` (no partner-intelligence oversight screen) |
| Security | `COMPLETE` on what exists (RBAC via `mapUserRoleToAiRole`; tool layer proven in Phase-8 P3-9) |
| Side effects | `COMPLETE` — nothing auto-modifies partner availability or partner state |
| Performance | `PARTIAL` — 4 geo-intel endpoints polled every 60s per partner session, unmeasured |

## Findings requiring a decision

| # | Item | Classification |
|---|---|---|
| 1 | `getForecast` applies hardcoded `*1.05` weekly and `*1.08` monthly growth multipliers with no basis, presented to partners as projections. Ground them or remove them. | `HUMAN_DECISION_REQUIRED` |
| 2 | Enabling tools on the partner gateway surface — read-only first, mirroring the customer path's `allowWrites: false`. | `HUMAN_DECISION_REQUIRED` |
| 3 | Scope and cadence of a morning briefing, including notification-governance budget for partner sends. | `HUMAN_DECISION_REQUIRED` |
| 4 | Minimum sample size before any performance nudge or peer percentile is shown. | `HUMAN_DECISION_REQUIRED` |
| 5 | Whether `/api/providers/me/intelligence` should be renamed — it returns repeat-customer stats, not intelligence, and the name invites over-crediting. | `HUMAN_DECISION_REQUIRED` |

## Blocked on external artifacts

| # | Item | Classification |
|---|---|---|
| 1 | Partner push delivery to a physical device (server path already verified in Phase-8 P1-1) — required before any briefing or nudge can be certified end to end. | `EXTERNAL_ARTIFACT_REQUIRED` |

## Confirmed constraints (already satisfied)

- **The LLM does not decide surge.** Surge is computed only in deterministic pricing/geo services;
  it appears in no AI module.
- **No guaranteed-income language** anywhere in partner web, partner mobile or the backend.
- **Nothing automatically modifies partner availability.** Availability changes only through the
  partner-controlled FSM and an explicit partner action.
- **No fabricated data** was found on any runtime partner path. The one unfounded element is the
  growth multiplier in finding #1, which is arithmetic on real data, not invented data.

## Next step

Awaiting instruction. No implementation has begun, and none should be assumed. Phase-8 hardening
remains closed as `PHASE_8_COMPLETE_WITH_FOLLOWUPS` and was not reopened by this audit.

---

## Implementation log

### Item 0 — D1 + D2 defect fixes: `COMPLETE`

Plan in `PARTNER_INTELLIGENCE_IMPLEMENTATION_PLAN.md`. Both blocked Capability 1, because both feed
partner AI tools.

**D1 — unfounded growth multipliers removed.** Investigated before changing: no comment, no
document, no model and no separate reasoning commit exists for `*1.05` / `*1.08` — both arrived
inside one bulk staging-RC commit (`b859fd1`). They were also applied to the wrong kind of number:
`myDashboard` derives `thisWeek` from `daysAgo(6)` and `thisMonth` from `daysAgo(29)`, so both are
COMPLETE trailing windows, not week-to-date. Both figures were rendered to partners as
"Weekly/Monthly Projection" on mobile and web.

Weekly/monthly are now TRAILING ACTUALS with no growth applied; the single-day extrapolation
fallbacks (`todayProjection * 7` / `* 30`) are gone; absent history returns `INSUFFICIENT_HISTORY`
rather than a number. A `basis` block now states method, source, freshness, predictive-or-not and
confidence for each figure. `todayProjection` remains genuinely predictive and carries the demand
model's own confidence and source.

Real-data verification (read-only, `homigo_db`, provider with 106 earning rows):
weekly `1288` == trailing-7d actuals, monthly `18918` == trailing-30d actuals, today `3240` from
demand priced at a real `avgPerJob` of `648`, confidence `0.5`, source `bigquery:arima_plus`.
**The old code would have reported ₹1,352 and ₹20,431 — ₹64 and ₹1,513 of invented earnings.**

**D2 — the performance tool now reports performance.** `read.partner.getPartnerPerformance` was
bound to `getProviderIntelligence`, which returns repeat-customer stats — so the copilot would have
answered "how is my performance?" with retention numbers. Added
`partnerOsService.getPerformanceSummary`, returning real stored counters (rating, completionRate,
acceptanceRate, cancellationRate, responseRate, response/completion times), volume, and retention
under its own key, plus a `basis` carrying `sampleSize` so callers can gate trend language.

Real-data verification: rating `4.95` (11 ratings), completion `99`, acceptance `71.26`,
cancellation `0`, response `99`, `completedInWindow 106`, retention `25%` repeat.

**Self-caught regression from Phase-8 P3-10 — FIXED.** `partner-operations.integration` failed
2 pass / 5 fail with `event_outbox: payload is not storable as JSON`. Cause: the `toInputJsonObject`
guard I added in P3-10 enumerated allowed types and rejected `Date` and `undefined` — but Prisma
serialises `Date` to an ISO string and drops `undefined` properties, so real domain events
(`time: new Date()`, optional correlation ids) were being refused. **My guard was too strict and
broke a working path; the outbox throw meant business transactions would abort.** The guard now
defers to `JSON.stringify`, the conversion the driver actually performs, which throws on exactly the
two things that cannot be stored (BigInt, circular). The P3-10 test that encoded the wrong belief
was corrected rather than left asserting a falsehood. `partner-operations.integration` is now
**7 pass / 0 fail**.

**Regression:** backend typecheck 0; partner mobile typecheck 0; 159 pass / 0 fail across 14 suites
(partner-intel-earnings-basis 11, p3-8-json-input 19, partner-operations.integration 7, the four
event suites 28, ai-tools 6, ai-tools-handler-contracts 8, p3-9 6, ai-brain 17,
p0-security-hardening 39, partner-acquisition-automation 10, phase7-post-service-security 8).

**No LIVE activation. No migration. `homigo_db` read-only throughout.**

**Next:** Item 1 — `PartnerIntelligenceContext` contract + `partner-intelligence.service.ts`.

### Item 1 — PartnerIntelligenceContext + partner-intelligence.service.ts: `COMPLETE`

**Files added:** `src/services/partner-intelligence.types.ts` (the contract),
`src/services/partner-intelligence.service.ts` (aggregation only),
`src/__tests__/partner-intelligence-context.integration.test.ts` (32 tests).

**Contract.** Nine signals — location, demand, supply, surge, weather, jobs, earnings, performance,
zoneCandidates — each an independent `Signal<T>` carrying `state`, `value`, `source`, `observedAt`,
`freshness`, `confidence` and a `reasonCode` when not OK. States: OK / UNAVAILABLE / STALE /
INSUFFICIENT_DATA / MODEL_UNAVAILABLE. Freshness: REAL_TIME / NEAR_REAL_TIME / HISTORICAL /
FORECAST / STATIC / UNKNOWN. Every context is stamped `rulesVersion` (`pi.rules.v1`) and reports a
model version ONLY when that model actually answered.

**Sources — all existing, none duplicated.** demand → `geoIntelligenceService.demandForecast`
(`bigquery:arima_plus`); supply → `providerDensity`; surge → `surgePrediction` (deterministic,
weather-aware); zone components → `zoneScoring` carried through unchanged; weather →
`weatherService`; earnings → `partnerOsService.getForecast` (Item-0 corrected) +
`providerService.myEarningsSummary`; performance → `getPerformanceSummary` (Item-0 added); jobs and
location → Prisma. This layer's only original logic is location-freshness grading and
distance-to-zone.

**Location freshness is grounded, not invented.** `LIVE` = 60s, anchored to the platform's own
`PRESENCE_TTL_SEC = 60` in `tracking.service` (partner app pings on 10s/25m). RECENT 10m, STALE 60m;
past that the fix is withheld entirely rather than described as "where you are".

**Isolation of failure.** `intel()` throws when its source is down, so every collector is wrapped:
one unavailable model degrades ONE section, never the whole context.

**Ranking deliberately excluded.** `zoneCandidates` are canonical and UNRANKED — ranking belongs to
`zone-recommendation.service.ts`. Aggregation must not encode one service's opinion of "best".

**Two shape assumptions I got wrong and corrected against the running service:** `zoneScoring().data`
is an object (`{ ranked, ... }`), not an array; and zone centres live on the density snapshot, not
the scoring rows. Both were caught by real-data verification, not by types.

**Real-data verification** (read-only, `homigo_db`, provider with 106 earning rows): 9/9 signals
resolved; demand OK conf 0.5 `bigquery:arima_plus`; supply/surge/zoneCandidates 7 zones each, 7/7
with real centres; location correctly `STALE/LOCATION_EXPIRED` and weather correctly cascading to
`NO_LOCATION_FOR_WEATHER`; `distanceKm` null rather than 0. Latency cold 1455ms / warm 42ms — the
existing geo-intel cache is sufficient, so **no new cache layer was added**.

**Tests: 32 pass / 0 fail** on the ISOLATED `homigo_p39`. Includes the required guarantee that a
missing signal stays UNKNOWN/UNAVAILABLE and never becomes a fabricated default, plus graded
location freshness, cross-partner isolation, determinism, sampleSize, and "zero jobs is a fact, not
a missing signal". The suite REFUSES to run outside `homigo_p39` — verified by deliberately running
it without the override (it aborted; `homigo_db` providers unchanged at 162).

**Regression:** backend typecheck 0; partner mobile typecheck 0; 32 + 138 pass / 0 fail across 13
suites.

**POST_PHASE_FOLLOWUP (not mine, not a blocker):** `partner-operations.integration.test.ts` — an
UNTRACKED test file — went 7/0 to 6/1. Cause proven: `findBestProviders` caps at `maxResults = 10`
while `homigo_test` has grown to 349 active providers across accumulated runs, so the test's own
provider falls out of the top-10 it asserts membership of. `matching.service` imports none of my
changed modules. Test-isolation drift, not a product defect.

**Next:** Zone Recommendations (Capability 7), consuming `zoneCandidates`.

### Item 2 — Zone Recommendations (Capability 7): `COMPLETE` (flag OFF, not LIVE)

**Files added:** `src/services/zone-recommendation.service.ts`,
`src/__tests__/zone-recommendation.integration.test.ts` (17 tests).
**Modified:** `src/routes/providers.ts` — added `GET /api/providers/me/intel/zones`.
Item 1 untouched; ranking lives outside aggregation, as required.

#### The finding that shaped the whole design

Measured on live data, the platform's `zoneScoring.compositeScore` is INVERTED for partners.
`serviceHealth = activeBookings === 0 ? 100 : (supply/activeBookings)*100`, so an idle zone scores
perfectly:

    Smoke Zone — Bangalore   composite 100  surge 1.00  activeBookings 0    ← platform ranks FIRST
    Noida Sector 62          composite 1    surge 2.88  activeBookings 24   ← platform ranks LAST

For a partner, low service health IS the opportunity. Reusing the platform composite would have sent
partners to the emptiest zones. It is carried as evidence, never as the ranking.

Also measured: `demandScore` and `earningScore` hold only TWO distinct values (0 or 100) on current
data — they are `x/max*100` over 24h, so sparse days collapse them to a binary. They are evidence,
never weighted; a binary dressed as a percentage would look precise while adding nothing.

#### Ranking model — `zone.rules.v1`

Dimensions chosen from observed variance, not a template:
UNMET_DEMAND 0.35 · SURGE 0.25 · DEMAND_TREND 0.15 · TRAVEL 0.15 · PARTNER_HISTORY 0.07 ·
COMPETITION 0.03.

Weighted mean over CONTRIBUTED dimensions only, renormalised by available weight — a missing signal
lowers `coverage` and `confidence` instead of scoring zero. Weather is NOT a dimension: it is already
inside `predictedSurge` as `weatherSurge`, and counting it twice would double-weight one fact.
Sorting is score-then-zoneId, so output is byte-identical for identical input.

Every zone returns six `reasons` with `{code, state, value, subScore, weight, source, observedAt,
reasonCode}`, plus `evidence`. **The score is recomputable from its own reasons** — asserted in the
suite, so the number is never an opaque output.

#### Real observation (live data, read-only)

    rank score cov  conf  zone                  active surge dDelta%  platformScore
    1    97    0.78 0.55  Noida Sector 62       24     2.88  +2300    1
    2    94    0.85 0.60  NCR Gurugram Polygon  5      3.00  +400     6
    4    7     0.85 0.60  Smoke Zone Bangalore  0      1.00  -100     100

TRAVEL reported `UNAVAILABLE/LOCATION_EXPIRED` rather than assuming zero distance;
PARTNER_HISTORY reported `INSUFFICIENT_HISTORY/NEEDS_3_JOBS`. Latency ~1.5s cold, warm context 42ms.

#### Personalisation — honest result

Four real partners (106/14/7/2 completed jobs) produced DIFFERENT scores (94/95/96/99) and the
fourth produced a different ORDER. But rankings largely converge, and the reason is recorded rather
than engineered away: TRAVEL (0.15) is unavailable for all of them (no live GPS) and PARTNER_HISTORY
carries only 0.07, so the partner-independent live-opportunity signals dominate. The mechanism is
proven separately under controlled fixtures: distance differs per zone between two partners standing
apart, and clearing the 3-job floor flips PARTNER_HISTORY from INSUFFICIENT_HISTORY to CONTRIBUTED.

#### Security + flag

`GET /api/providers/me/intel/zones` — identity from `requireProvider()`, never from input.
Unauthenticated → **401** (observed). Flag `PARTNER_ZONE_RECOMMENDATIONS` absent → **404**
(observed, authenticated partner) — fail-closed, and 404 rather than 403 so an ungated capability
does not advertise itself. **The flag row was deliberately NOT created in `homigo_db`**: creating it
would enable the capability for real partners, i.e. LIVE activation.

#### Side effects: ZERO

`bookings=405 payments=268 wallet=30 notif=5601 outbox=2162 wfinst=724` — byte-identical before and
after observation.

#### Failures found and classified

- `FIXTURE_DEFECT` — my fixture created COMPLETED bookings without `completedAt`, rejected by the
  `booking_completed_requires_timestamp` check constraint. The schema was right; the fixture was fixed.
- `HARNESS_DEFECT` — first run was VACUOUS: 16 tests, 6 expect() calls, because the isolated DB had
  no zones so every assertion early-returned. Zone geometry (platform config, not partner history)
  is now seeded and a guard test fails loudly if candidates ever disappear. Now 17 tests, 81 expects.
- `HARNESS_DEFECT` — a travel assertion compared rank-ordered arrays; both partners legitimately read
  [0, 57] because each one's own nearest zone ranks first. Corrected to compare per zone.

**Regression:** backend typecheck 0; partner mobile typecheck 0; 49 pass (isolated) + 121 pass
(standard) / 0 fail.

**Certification:** none. This is a request-response capability, not a workflow, so it is gated by the
feature-flag mechanism rather than `certifyAutomation` — per the brief's instruction not to pretend
every intelligence feature is a workflow.

**Blockers:** enabling `PARTNER_ZONE_RECOMMENDATIONS` for real partners is `HUMAN_DECISION_REQUIRED`.

**Next:** Earnings Coach (Capability 4).

### Item 3 — Earnings Coach (Capability 4): `COMPLETE` (flag OFF, not LIVE)

**Files added:** `src/services/earnings-coach.service.ts`,
`src/__tests__/earnings-coach.integration.test.ts` (26 tests).
**Modified:** `src/routes/providers.ts` (`GET /me/intel/earnings-coach`),
`src/ai-tools/registry/tool-catalog.ts` + `execution/handlers/index.ts`
(`read.partner.getEarningsOpportunity`).

#### Earnings contract — Item-0 discipline preserved

No growth multiplier was reintroduced. Weekly/monthly remain trailing ACTUALS. Everything is NET
(what the partner receives), never gross — on live data the two are ~19% apart, and a net gap
divided by a gross per-job value would understate the jobs required by about a fifth. A test asserts
`averageNetPerJob === 500` against a fixture whose gross is 625, so a gross/net regression fails
loudly rather than silently changing the advice.

#### Three kinds of number, deliberately never merged

- **REALISED** — today / trailing 7d / trailing 30d, from the earnings ledger. Facts.
- **OPPORTUNITY** — the partner's own net average per job with a standard error, applied to the gap.
  An estimate with a stated error, not a forecast.
- **FEASIBILITY** — whether the required job count sits inside what this partner has actually done
  in a day. A comparison against their record, not a prediction.

There is **no field** anywhere that says how much the partner will earn. A test scans the whole
serialised plan for "guarantee", "you will earn", "assured", "promised", "projectedEarnings",
"expectedEarnings" and fails if any appears.

#### Thresholds derived from measured data, not chosen

`MIN_JOBS_FOR_PLAN = 3`, derived from relative standard error `CV / sqrt(n)`. Measured CV of
net-per-job across live partners is ~0.34 (mean 568, sd 192), so n=3 gives ~20% relative error —
the point where a standard deviation is computable and still quotable. It reuses the sample floor
already established for zone history rather than introducing a second threshold.

`PEAK_HOUR_MULTIPLE = 2` — an hour is only called a window when it has at least
`MIN_JOBS_FOR_PLAN` jobs AND at least twice the partner's own average jobs-per-active-hour.
Measured: admits the partner with 40 jobs in one hour (6.4x their 6.2 average), refuses the one
whose "peak" is 3 against a 1.75 average, because that is noise.

Also measured and acted on: per-partner HOURLY patterns are only viable for high-volume partners
(top partner 106 jobs across 17 hours; others 2-14 jobs), so the window claim is gated rather than
always produced.

#### Real observation — live data and the real endpoint

Direct service call against `homigo_db` (read-only), partner with 106 jobs:
realised today 0 / 7d 1,288 / 30d 18,918 · avgNetPerJob **467 ±18** · **7 jobs needed** ·
sample 106 · confidence 0.95 · feasibility **REQUIRES_BEST_DAY** (typical 2.6/day, best 13) ·
3 ranked zones · 3 partner time windows (5:00 at 6.4x concentration).

Through the real HTTP endpoint on the ISOLATED database, flag enabled there only:
**HTTP 200, 828 ms**, state OK, realised 7d 2,500 / 30d 5,000, avgNet 500, 6 jobs needed,
`WITHIN_TYPICAL_DAY`, degraded `["LOCATION_NO_LOCATION_ON_FILE","WEATHER_UNAVAILABLE"]`.

#### Security — 9/9 spoofing attempts denied

With the flag ON, a partner holding a token for a provider with NO earnings tried
`providerId`, `partnerId`, `userId`, `actorId` (all pointing at the rich partner), plus
`admin=true`, `allUsers=true`, `confirmed=true`, `role=ADMIN`. **Every response returned that
partner's own state** (`INSUFFICIENT_HISTORY`, `trailing30d: null`) — never the other partner's
5,000. Unauthenticated 401; flag absent 404 (fail-closed); `target=-5` 400 once reachable.

#### Side effects: ZERO

`bookings=423 earnings=164 payments=282 wallet=30 withdrawals=23 ledger=1663 notif=5890 outbox=2360`
— byte-identical before and after. The coach opens no transaction. A test independently asserts row
counts are unchanged across two plan calls.

#### Feature flag and certification

`PARTNER_EARNINGS_COACH` — **no row created in `homigo_db`** (verified: 0 PARTNER_* flags there).
Enabled only inside the isolated database for observation. This is a request-response capability,
not a workflow, so it is gated by the feature-flag mechanism rather than `certifyAutomation` —
consistent with Zone Recommendations and with the instruction not to treat every intelligence
feature as a workflow. **LIVE remains blocked.**

#### Copilot contract

`read.partner.getEarningsOpportunity` — READ, LOW risk, `requiredRole: PARTNER`,
`requiredPolicy: partner.self`, identity resolved server-side. `targetAmount` is the only
caller-supplied value and cannot widen scope. Catalog is now 56 tools (30 READ / 12 WRITE /
14 HIGH_RISK); **HIGH_RISK remains 0/14 bound** — re-verified after the change. The catalog is
therefore no longer byte-identical to the Phase-5 freeze commit, but the freeze property it
protects (no bound high-risk tool) is intact.

#### Failures found and classified

- `ENVIRONMENT` — the isolated database was a **stale schema clone** (missing
  `providers.compliance_restricted`, added to `homigo_db` after the Phase-8 clone). Recreated from
  the current schema; 193 tables, 0 rows. `homigo_db` untouched (read-only `pg_dump` source).
- `FIXTURE_DEFECT` — the suite assumed a service row existed. Made self-sufficient so it runs
  against a freshly cloned schema.
- `FIXTURE_DEFECT` — fixture providers were not approved, so `assertPartnerCanLogin` correctly
  returned 403. The guard was right; the fixture was wrong.
- `FIXTURE_DEFECT` (informative) — the flag was first created with `environment: "development"`
  while `APP_ENV=dev`, so it did not match and the endpoint stayed 404. **That is fail-closed
  working as designed**: a flag enabled for the wrong environment does nothing.

#### Documented limitation

With all history concentrated in a single hour, the concentration ratio is degenerate (1.0) and no
window is produced. Conservative by design — "always works at 9am" and "only has data at 9am" are
indistinguishable without spread. Real multi-hour data produced windows correctly.

**Regression:** backend typecheck 0; partner mobile typecheck 0; **203 pass / 0 fail** across 13
suites (75 isolated-DB + 128 standard).

**Next:** Smart Shift Planning (Capability 5).

### Item 4 — Smart Shift Planning (Capability 5): `COMPLETE` (flag OFF, not LIVE)

**Files added:** `src/services/shift-planning.service.ts`,
`src/__tests__/shift-planning.integration.test.ts` (22 tests).
**Modified:** `src/routes/providers.ts` (`GET /me/intel/shift-plan`).
No new engine: context, zones, windows and availability all come from existing services.

#### THE FINDING THAT SHAPED THE CAPABILITY — the demand model cannot pick an hour

The obvious design picks the hour with the highest predicted demand. Measured against the live
model, that is impossible to do honestly:

| Measurement | Value | Consequence |
|---|---|---|
| Forecast horizon start | `2026-06-20` against a `2026-08-27` clock — **68 days in the past** | ARIMA forecasts forward from its last training row; it has not been retrained. Mapping those hours onto "today" would present a June forecast as today's plan. |
| Hourly spread | min 2.02, max 2.03 — **0.010 across 24 hours** | There is no peak in the data to find. |
| Confidence interval | widens 1.63 → 10.92 over the horizon | By the end the interval is several times the prediction. |
| Zone resolution | every point is `zone_id: "unzoned"` | Cannot inform per-zone timing either. |

Choosing a "best hour" from a 0.010 spread would be inventing a peak. Demand is therefore reported
with an explicit `DEMAND_FORECAST_STALE` state and **excluded from window selection**; windows come
from the partner's own history through the earnings coach, where they are already gated behind a
measured concentration test. Recorded as `POST_PHASE_FOLLOWUP` — the model needs retraining; it is
not a blocker because the capability degrades honestly without it.

#### Advisory only — proven structurally, not asserted

The service holds **no database handle at all**. A structural test asserts the source contains no
`$transaction`, no `prisma.provider.update`, no `prisma.booking.*`, no `prisma.earning.`, no
`prisma.walletTransaction`, no `prisma.withdrawal`, no `setOnline` / `updateAvailability` /
`pauseProvider` / `resumeProvider`, and does not import prisma. A second test compares six row
counts across two plan calls and asserts they are unchanged.

#### Trade-offs surfaced, never hidden

11 conflict codes, each with a severity and a human explanation:
`HIGH_OPPORTUNITY_FAR_TRAVEL` · `STALE_LOCATION_LIMITS_TRAVEL` · `NO_LOCATION_LIMITS_TRAVEL` ·
`ACTIVE_JOB_IN_PROGRESS` · `WEATHER_UNAVAILABLE` · `SEVERE_WEATHER` · `DEMAND_FORECAST_STALE` ·
`DEMAND_UNAVAILABLE` · `ROUTE_UNAVAILABLE` · `OUTSIDE_WORKING_HOURS` · `PARTNER_OFFLINE`.

**A defect in my own logic, caught by real observation:** the partner's strongest window (05:00,
40 jobs, 6.4x concentration) was being **silently clamped away** by a declared 09:00-18:00 shift,
and the plan said nothing — `OUTSIDE_WORKING_HOURS` only fired when *every* window was outside.
Fixed so any excluded window is reported: *"Your history is strongest at 05:00, 07:00, which your
declared 09:00-18:00 window excludes."*

#### Real observation — live data

Partner with 106 jobs, `homigo_db` read-only:
state OK, latency 2,383 ms, coverage 0.86, confidence 0.68 ·
rules `shift.rules.v1 / pi.rules.v1 / zone.rules.v1 / coach.rules.v1` ·
shift **09:00 → 12:00** · windows 05:00 (40 jobs, 6.4x), 11:00 (16, 2.6x), 07:00 (15, 2.4x) ·
zones Noida Sector 62 (82), NCR Gurugram (80), Delhi CP (32) ·
travel STALE location, farthest 1,741.7 km, route unavailable ·
5 conflicts including `HIGH_OPPORTUNITY_FAR_TRAVEL` (1,739.5 km) and `SEVERE_WEATHER` (Rain,
moderate) and `ACTIVE_JOB_IN_PROGRESS` (1 job).

#### What the concentration rule actually does (learned from a failing fixture)

A fixture with 12 and 8 jobs in two hours produced **no windows at all**: two comparable peaks raise
the partner's own average per active hour until neither clears the 2x threshold. That is the rule
working — "stands out from your own pattern" is meaningless when everything is the pattern. The
fixture was rebuilt with genuinely dominant peaks (20 + 20 against eight single-job hours, average
4.8, threshold 9.6) so both qualify and the partial-exclusion case is exercised: windows 06:00 and
11:00 at 4.2x, shift clamped to 09:00-12:00, 06:00 reported as excluded.

#### Security and flag

`GET /api/providers/me/intel/shift-plan` — identity from `requireProvider()`.
Unauthenticated **401**; flag absent **404** (fail-closed, observed with a real partner token).
`PARTNER_SHIFT_PLANNING` — **no row created in `homigo_db`** (verified: 0 PARTNER_* flags).
Request-response capability, so gated by the feature flag rather than `certifyAutomation`.
**LIVE remains blocked.**

#### Failures found and classified

- `APPLICATION_DEFECT` (mine, fixed) — silently clamped windows, described above.
- `HARNESS_DEFECT` — determinism assertion compared `observedAt`, which records *when each signal
  was read* and is meant to differ. Stripped, matching the coach suite.
- `FIXTURE_DEFECT` — first fixture produced no windows (see concentration rule above); second
  assumed a window would fit inside declared hours when none did. Both rebuilt so the suite
  exercises the interesting path rather than skipping it.

#### Known limitations

- Demand cannot inform timing until the ARIMA model is retrained (`POST_PHASE_FOLLOWUP`).
- Route is enrichment only: with no live position `routeAvailable` is false and travel is reported
  as a limitation rather than a filter — no zone is eliminated for lack of routing.
- A partner whose entire history sits in one hour gets no window (concentration is degenerate at
  1.0). Conservative by design.

**Regression:** backend typecheck 0; partner mobile typecheck 0; **225 pass / 0 fail** across 14
suites (97 isolated-DB + 128 standard).

**Next:** Performance Nudges (Capability 6).

### Item 5 — Performance Nudges (Capability 6): `COMPLETE` (flag OFF, not LIVE)

**Files added:** `src/services/performance-nudges.service.ts`,
`src/__tests__/performance-nudges.integration.test.ts` (24 tests, 125 assertions).
**Modified:** `src/routes/providers.ts` (`GET /me/intel/nudges`),
`src/ai-tools/registry/tool-catalog.ts` + `execution/handlers/index.ts`
(`read.partner.getPerformanceNudges`).

#### THE FINDING THAT DECIDED THE DESIGN — the stored counters are unmaintained

`Provider` carries `completionRate`, `cancellationRate`, `responseRate`, `avgResponseTime` and
`avgCompletionTime`. Measured against live data:

| Counter | Writer | Live state |
|---|---|---|
| `acceptanceRate` | `assignment-engine.refreshProviderAcceptanceRate` (30-day window) | maintained |
| `completionRate` | **none found anywhere** | 0 |
| `cancellationRate` | **none** | 0 |
| `responseRate` | **none** | 0 |
| `avgResponseTime` / `avgCompletionTime` | **none** | 0 |

**160 of 173 providers carry `0|0|0|0` for all four rates**, with a handful at seeded 100s. Coaching
a partner from those fields would have told someone with a hundred completed jobs that their
completion rate is 0%. Every metric is therefore computed from the underlying events.

#### Definitions are the platform's, not new ones

- **Acceptance** — `ACCEPTED / (ACCEPTED + REJECTED + TIMEOUT)` on `AssignmentAttempt.dispatchedAt`,
  copied exactly from the assignment engine. TIMEOUT stays in the denominator because dispatch
  counts it; a kinder denominator here would mean the number a partner is coached on differs from
  the number that actually governs their dispatch.
- **Completion** — `COMPLETED / (COMPLETED + CANCELLED_BY_PROVIDER)`.
- **Partner cancellation** — `CANCELLED_BY_PROVIDER / (COMPLETED + CANCELLED_BY_PROVIDER)`.
  `CANCELLED_BY_USER` is excluded from both, and a test proves adding one moves neither number: a
  partner must never be nudged for a customer's decision.
- **Rating** — mean of `Rating.stars` in the period.
- **Window** — 30 days current versus the prior 30, taken from the assignment engine rather than
  invented, exactly as the brief required.

#### No arbitrary sample minimum — significance is derived

A change is reported only when it exceeds **two standard errors of the difference** between the two
periods, so the data decides what is distinguishable from noise. Proportions are **Agresti-Coull
adjusted** (add two successes and two failures) first.

That adjustment is the whole anti-fabrication mechanism. Without it, 1-of-1 gives p = 1.0 with zero
standard error and *any* difference clears the bar. With it, 0-of-1 versus 1-of-1 becomes 40% versus
60% — a 20-point difference against a 62-point threshold — and correctly reports nothing.

Measured coverage: 29 partners have dispatch history; 15 have >= 10 decided offers in both windows,
12 have >= 30. The test admits those partners while the rest receive INSUFFICIENT_HISTORY, with no
hard cutoff excluding anyone by fiat.

#### A defect in my own output contract, caught by my own test

`change` was the RAW movement while `significanceThreshold` was derived from the ADJUSTED
difference — two numbers on different scales. For the thin partner that read as `change = 100`
against `threshold = 62`, so anyone comparing the published evidence would conclude a trend existed
while the service correctly reported none. The result was not recomputable from its own evidence.

Fixed by publishing **`adjustedChange`** alongside `change`: the shrunk difference the test actually
used, on the threshold's scale. Live example: acceptance `change = 45`, `adjustedChange = 40.9`,
`threshold = 17.4` — now directly comparable.

#### Non-punitive and non-causal by construction

Severities are `INFO` / `OPPORTUNITY` / `IMPROVEMENT` / `WARNING`. Messages state what moved, by how
much, over which sample — never why. A test scans generated messages for "because", "due to",
"caused", "you failed", "careless", "unreliable", "poor", "bad", "lazy" and fails on any. No causal
claim is made from observational metrics.

#### Real observation — real endpoint

`GET /api/providers/me/intel/nudges` on the ISOLATED database, flag enabled there only:
**HTTP 200 in 390 ms**, state OK, window 30d, `nudge.rules.v1`.

    ACCEPTANCE_RATE             OK  50 -> 95    n=40/40  adj=40.9  thr=17.4  significant
    COMPLETION_RATE             OK  93.8 -> 37.5 n=32/32  adj=-50   thr=19.3  significant
    PROVIDER_CANCELLATION_RATE  OK  6.3 -> 62.5  n=32/32  adj=50    thr=19.3  significant
    AVERAGE_RATING              INSUFFICIENT_HISTORY (0 ratings)

Against live `homigo_db` (read-only), a partner with 302 attempts produced the same three nudge
types with real values (acceptance 52.2 -> 72.4 against a 14.7 threshold), while ratings of 5.0
versus 5.0 correctly produced nothing — zero variance means no estimable error.

#### Security — 8/8 spoofing attempts denied

A partner whose provider has NO events tried bare, `providerId`, `partnerId`, `userId`, `actorId`
(all pointing at the trend partner), `admin=true`, `allUsers=true`, `role=ADMIN`. **Every response
returned that partner's own state** — `INSUFFICIENT_HISTORY`, acceptance sample 0 — never the other
partner's 40. Unauthenticated 401; flag absent 404 (fail-closed).

#### Side effects: ZERO

`bookings=423 earnings=164 attempts=2553 ratings=19 wallet=30 notif=5890 outbox=2289` — byte
identical before and after. A test independently asserts seven row counts are unchanged across two
computations. **Nothing is sent:** computation is separated from notification entirely, and a test
asserts the service contains no `routeNotification`, `sendPush` or channel adapter reference. Any
future automated path must run event/schedule -> eligibility -> computation -> governance -> SHADOW.

#### Feature flag and tool

`PARTNER_PERFORMANCE_NUDGES` — **no row in `homigo_db`** (verified: 0 PARTNER_* flags there).
`read.partner.getPerformanceNudges` added: READ, LOW risk, `partner.self`, **no parameters at all**,
so there is nothing for a caller to spoof. Catalog now 57 tools (31 READ / 12 WRITE / 14 HIGH_RISK);
**HIGH_RISK re-verified 0/14 bound.**

#### Failures found and classified

- `APPLICATION_DEFECT` (mine, fixed) — `change` and `significanceThreshold` on different scales;
  `adjustedChange` published so results are recomputable.
- `FIXTURE_DEFECT` — fixture guessed the `AssignmentJob` / `AssignmentAttempt` shape; both require
  real foreign keys, so every offer needs a backing booking. The schema was right.
- `FIXTURE_DEFECT` — `bookings_user_slot_excl` is an INCLUSIVE range, so hourly spacing still
  collided, and separate seeding batches collided with each other. Resolved with one customer per
  batch, which is also the more faithful fixture.
- `HARNESS_DEFECT` — determinism assertion compared period boundaries derived from `now`.
- `HARNESS_DEFECT` — `beforeAll` timed out once the database grew: ~320 sequential round-trips.
  Rewritten with `createMany` (three inserts plus two id lookups); suite now runs in 2.8 s and
  passed **3 consecutive runs**.

**Regression:** backend typecheck 0; partner mobile typecheck 0; **262 pass / 0 fail** across 16
suites (121 isolated-DB + 141 standard).

**Next:** Morning Intelligence (Capability 2) — the first capability that is an automation rather
than a request-response surface, so it takes the workflow + SHADOW certification path.

---

## Item 6 — Morning Intelligence — IMPLEMENTATION COMPLETE, SCHEDULE BLOCKED

**Capability state:** `DISABLED_UNTIL_SCHEDULE_APPROVED`
**Schedule decision:** `HUMAN_DECISION_REQUIRED`
**Real scheduled observation:** `BLOCKED_BY_BUSINESS_SCHEDULE`
**Certification:** `NOT_READY` — no scheduled observation evidence can exist yet
**LIVE:** blocked, structurally

### The blocking discovery

There is no canonical time-of-day scheduler anywhere in this platform, so there is no morning time to
look up. Three independent checks:

- the event catalog is entirely business-event driven — no `DAILY`, `SCHEDULED`, `TICK` or `CRON` type
- every job in `maintenance.ts` is interval-based (`every N ms`); none runs at a wall-clock hour
- no "morning" concept exists in code, only the words "the morning briefing" in a types comment

`AUTOMATION_QUIET_END_MINUTE` = 08:00 is the nearest real value and was **deliberately not used**. It
is the earliest moment a message is *permitted*, not an answer to when a brief is *useful*. Adopting
it would be a decision nobody made wearing the costume of one.

`morningSchedule = { enabled: false, localTime: null, timezoneStrategy: "recipient-local", status: "UNSET" }`
is the shipped state, and `assertScheduleIsNotDerivedFromQuietHours()` fails any future config that
sets `localTime` to the quiet-hours boundary without an explicit acknowledgement.

### What was built (unblocked work, all complete)

| Artifact | File |
|---|---|
| Schedule boundary | `src/services/morning-schedule.config.ts` |
| Brief contract | `src/services/morning-intelligence.types.ts` |
| Brief assembler | `src/services/morning-intelligence.service.ts` |
| Workflow `morning_intelligence.v1` | `src/automation/registry/definitions/morning-intelligence-workflow.ts` |
| Trigger mapping | `trigger-registry.ts` — `PARTNER_MORNING_INTELLIGENCE_DUE` → provider subject |
| Eligibility condition | `condition-registry.ts` — `provider.morning_eligible` (6 clauses) |
| Resolver fields | `provider.resolver.ts` — `isActive`, `isBanned`, `complianceRestricted`, `paused`, `userBanned` |
| Template | `templates/definitions.ts` — `partner.morning_intelligence` (PUSH + IN_APP) |
| Channel policy | `channel-policy.ts` — `["PUSH", "IN_APP"]`, EMAIL deliberately excluded |
| Containment | `containment.ts` — `morning_intelligence` added |
| Tests | `src/__tests__/morning-intelligence.integration.test.ts` — 49 tests / 177 assertions |

Nothing is recalculated: the brief composes `getContext()`, `shiftPlanningService.plan()`,
`earningsCoachService.plan()` and `performanceNudgesService.compute()`. Eligibility reuses the
dispatch composite from `matching.service.ts` verbatim rather than inventing a seventh clause.

### Four independent barriers to a send

1. `morningSchedule.localTime = null` — no scheduled execution can be created
2. nothing publishes `PARTNER_MORNING_INTELLIGENCE_DUE` — a test asserts the publisher set is empty
3. `executionMode: SHADOW` + `certificationStatus: DRAFT` — the registry throws on LIVE-uncertified
4. `morning_intelligence` is in `CONTAINED_WORKFLOW_IDS`

`PARTNER_MORNING_INTELLIGENCE` flag: **no row created in `homigo_db`**; absent = `FLAG_MISSING` = off,
verified fail-closed by test. Stated precisely: the flag is *not* currently wired to a gate, because
Item 6 exposes no request-response surface to gate — it is a workflow, and the four barriers above
are what hold it. The flag name is reserved and its off-state asserted so that whoever adds a partner
-facing brief endpoint has the check already defined rather than inventing a new key.

### Real observation (component, not scheduled)

Three real eligible partners from `homigo_db`, read-only, 2026-08-28/29:

```
state=PARTIAL  coverage 0.625 / 0.5 / 0.5
signals: location=STALE|UNAVAILABLE demand=STALE supply=OK surge=OK
         weather=UNAVAILABLE jobs=OK earnings=OK|INSUFFICIENT_DATA performance=OK
zones ranked: NCR Gurugram(99) Noida Sector 62(97) Delhi CP(37)
realized: {today:0, trailing7d:0, trailing30d:790, INR}
opportunity: {avgNetPerJob:427, se:8, n:7, confidence:0.95}
latency: 1825ms cold, 112-157ms warm
```

**Side effects: ZERO** — 9 counters (bookings, notifications, deliveries, workflow instances,
scheduled jobs, outbox, payments, wallet, ledger) byte-identical before and after.

This is explicitly **not** a scheduled morning execution and is not offered as one.

### Defect found and fixed (real, mine)

`APPLICATION_DEFECT` — the first observation produced `demand.state = "OK"` in the same brief as
`SHIFT_DEMAND_FORECAST_STALE`. Cause: `buildDemand()` marks demand OK whenever the model returns
points and never asks whether its horizon has elapsed; only Item 4 asked that, privately. A consumer
reading the signal would have described an expired forecast as this morning's demand.

Fixed by promoting `isDemandForecastStale()` out of `shift-planning.service.ts` as an exported
function — **one** definition of stale demand, imported by both — and re-checking at read time in the
brief. Item 4 delegates to it and is behaviourally unchanged (22/22 still pass). After the fix the
same partners read `demand=STALE` with `DEMAND_FORECAST_STALE`, and coverage honestly fell
0.75 → 0.625.

### Failures found and classified

- `APPLICATION_DEFECT` (mine, fixed) — demand OK/STALE contradiction, above.
- `FIXTURE_DEFECT` — a forbidden-substring test searched for `"expo"`, which matches `export` on
  almost every line and failed against correct code. Narrowed to identifier form.
- `HARNESS_DEFECT` — the "nothing publishes this trigger" test greps the source tree and took 7.1 s
  against a 5 s case timeout. Moved into `beforeAll`, computed once.
- `HUMAN_DECISION_REQUIRED` — the morning time itself. Nothing technical blocks it.

### Regression

backend typecheck **0** · partner-web typecheck **0** · **233 pass / 0 fail / 810 assertions**
across 11 suites (7 Partner Intelligence + 4 automation/regression) · AI catalog unchanged at 57
tools (31/12/14) with **HIGH_RISK 0/14 bound**, re-verified through the runtime registry.

### What a human must decide

Morning execution local time. Everything else is built, tested and inert. Once a time is approved:
set `morningSchedule` to `{enabled: true, localTime: "HH:MM", status: "APPROVED"}`, emit the trigger
from a leader-locked tick, observe SHADOW evidence, then seek certification with a real ADMIN
approver.

**Next:** Item 7 — Surge Automation.

---

## Item 7 — Surge Automation — IMPLEMENTATION COMPLETE, POLICY BLOCKED

**Capability state:** `DISABLED_UNTIL_POLICY_APPROVED`
**Threshold / hysteresis / cooldown:** `HUMAN_DECISION_REQUIRED`
**Trigger event semantics:** `ARCHITECTURAL_GAP` + `HUMAN_DECISION_REQUIRED`
**Real surge observation:** `REAL_SURGE_OBSERVATION_PENDING`
**Certification:** `NOT_READY` · **LIVE:** blocked, structurally

### The finding that shapes everything else

Three different things are called surge, and **only one reaches money**:

| Surge | Computed in | Customer price | Partner payout |
|---|---|---|---|
| `weatherService.surgeMultiplier()` | `booking-pricing.service` | **YES** to `weatherSurgeAmount` to `chargeableBase` | **YES** |
| `geofence.surgeMultiplier` | Geofence row | no — read only by geo-intel + a metrics gauge | no |
| `surgePrediction().predictedSurge` | `geo-intelligence` | no — informational | no |
| `dynamicPricingService` stack | `dynamic-pricing.service` | no — sole caller is `routes/pricing.ts` | no |

`geofenceService.isServiceable()` returns a surge multiplier and has exactly one caller
(`routes/geo.ts:109`), which never reads it.

**Consequence:** an alert built on `predictedSurge` describes demand pressure a partner earns nothing
extra for. The template therefore carries no multiplier, no rupee figure and no "earn more", and says
in words that it reflects job availability, not a change to pay rate. A test asserts the template
block contains none of earn/payout/bonus, and that the workflow passes the notification only
`zoneName`, `demandEvidence`, `observedAt` — the surge number never reaches it.

### Source anomalies — recorded, not repaired

**`ZERO_SUPPLY_SIGNAL_ANOMALY`** — the source reads
`supply > 0 ? active/supply : (active > 0 ? 2 : 1)`, so a zone losing its last provider falls from
pressure `active/1` to a hardcoded 2. Measured: Gurugram 3.00 to 1.68 (−44%) at the exact moment the
zone becomes least able to serve anyone. **Not corrected here** — the source stays authoritative;
correcting it is `HUMAN_DECISION_REQUIRED`.

**`SIGNAL_SATURATED`** — `demandSurge` clamps at 2.5 (pressure >= 4.75). Gurugram at pressure 5 and
Noida at 24 both saturate, so the signal cannot separate busy from overwhelmed. Flagged per zone
rather than presented as a measurement.

**`DUPLICATE_ZONE_NAME`** — two active zones are both named "Delhi Connaught Place" with different
supply and different surge. `zoneId` is therefore the identity everywhere; `zoneName` is a label
only. Tests create twin-named zones and assert they stay distinct.

### Measured sensitivity (why hysteresis is a real question)

One provider toggling online/offline, computed from the formula:

```
NCR Gurugram (supply=1):  +1 -> -36%    -1 -> -44%
Noida        (supply=1):  +1 ->   0%    -1 -> -44.1%
Delhi CP     (supply=3):  +1 -> -11.6%  -1 -> +23.8%
```

Highest sensitivity is exactly where alerts would fire. A threshold chosen without hysteresis would
produce an alert stream toggling on single-provider movements.

### Policy is UNSET

`surgeAlertPolicy = { enabled: false, threshold: null, hysteresis: null, cooldownSeconds: null,
status: "UNSET" }`. `isSurgeAlertPolicyApproved()` requires all four; every partial combination is
tested and refused. **Not environment-driven** — an env var would let a deployment invent the
decision. A test asserts hysteresis is not borrowed from `governanceConfig.defaultCooldownMs`
(24 h) — notification cooldown and signal hysteresis are different questions.

### Trigger event: declared, no producer

`PARTNER_ZONE_SURGE_DETECTED` exists and nothing publishes it. Unlike Item 6 (where a clock was
missing), here the **semantics** are missing: surge is derived state, and the events that move its
inputs — `BOOKING_CREATED`, `PARTNER_ONLINE`, `PARTNER_OFFLINE` — fire on ordinary traffic, so
publishing from any of them would make this the highest-frequency producer in the catalog. A test
asserts the publisher set is empty.

### Files

| Artifact | Path |
|---|---|
| Policy boundary (UNSET) | `apps/backend/src/services/surge-alert-policy.config.ts` |
| Signal reader + evaluator | `apps/backend/src/services/surge-alert.service.ts` |
| Workflow `surge_alert.v1` | `apps/backend/src/automation/registry/definitions/surge-alert-workflow.ts` |
| Tests (41 / 174 assertions) | `apps/backend/src/__tests__/surge-alert.integration.test.ts` |

Modified additively: `event-types.ts`, `trigger-registry.ts`, `definitions/index.ts`,
`templates/definitions.ts`, `channel-policy.ts`, `containment.ts`.

Eligibility **reuses** `provider.morning_eligible` from Item 6 — no second definition.

### Real observation (component, not a surge transition)

7 real zones from `homigo_db`, read-only, 2026-08-29, latency 507 ms:

```
WOULD_NOT_EVALUATE  surge=3.00  supply=1 active=5   NCR Gurugram      [SIGNAL_SATURATED]
WOULD_NOT_EVALUATE  surge=2.88  supply=1 active=24  Noida Sector 62   [SIGNAL_SATURATED]
WOULD_NOT_EVALUATE  surge=1.47  supply=3 active=4   Delhi CP          [DUPLICATE_ZONE_NAME]
WOULD_NOT_EVALUATE  surge=1.00  supply=0 active=0   Delhi CP          [DUPLICATE_ZONE_NAME]
ALERT_WORTHY count: 0
```

**Side effects: ZERO** — 10 counters identical. `ZERO_SUPPLY_SIGNAL_ANOMALY` did not fire in this
sample because no zone currently has supply 0 with active jobs; the detector is covered by tests.

### Failures found and classified

- `APPLICATION_DEFECT` (mine, caught by the registry) — `maxAgeMs` of 2 h was rejected: a workflow
  with a NOTIFICATION step must outlive the 11 h quiet window or the instance expires before it can
  resume. Raised to 12 h; the resulting tension (an alert deferred past its own signal's life) is
  recorded as part of `SURGE_HYSTERESIS_POLICY_REQUIRED`, not silently resolved.
- `FIXTURE_DEFECT` x3 — forbidden-substring tests matched explanatory **comments**
  (`dynamicPricingService`, `weatherService`, `provider.surge_eligible` all appear in prose saying
  they are deliberately not used). Fixed with a `codeOnly()` helper that strips comments before
  searching, so the assertion means what it always meant.
- `HARNESS_DEFECT` — tree-wide `grep` took 10-15 s against a 5 s hook timeout. Replaced with an
  in-process scan: **1.7 s for 611 files**, measured. Applied to Item 6's suite too.
- `HARNESS_DEFECT` — the duplicate-name test passed alone and failed in the full run: another suite
  had warmed `surgePrediction()`'s 120 s cache before the fixtures existed. Fixed by invalidating
  `geo-intel:surge-prediction` in `beforeAll` rather than relaxing the assertion.
- `ENVIRONMENT` — `homigo_p39` had drifted (95 vs 97 provider columns; `lifecycle_state` missing
  after migration `20260829140000_section06_partner_performance` reached `homigo_db`). Isolated DB
  re-cloned from a read-only schema dump. **No migration was applied to `homigo_db`.**
- `ENVIRONMENT` — one transient geofence write-conflict/deadlock in a concurrent suite; did not
  recur across two clean runs.

### Regression

backend typecheck **0** · partner-web typecheck **0** · **260 pass / 0 fail** across 12 suites,
**twice** (1368 and 1404 assertions) · AI catalog 57 tools (31/12/14), **HIGH_RISK 0/14 bound**.

### What a human must decide

1. `SURGE_ALERT_THRESHOLD_REQUIRED` — against the measured distribution above
2. `SURGE_HYSTERESIS_POLICY_REQUIRED` — including what happens to an alert deferred overnight
3. `SURGE_ALERT_COOLDOWN_REQUIRED` — distinct from the notification cooldown
4. `SURGE_TRIGGER_EVENT_SEMANTICS_REQUIRED` — what constitutes a transition, and what may publish it
5. Whether to correct `ZERO_SUPPLY_SIGNAL_ANOMALY` in the source formula

**Next:** Item 8 — Explainable Insights.

---

## Item 8 — Explainable Insights — COMPLETE

**Capability state:** `IMPLEMENTED` · **Certification:** not applicable (see below) · **LIVE:** n/a
**Feature flag:** `PARTNER_EXPLAINABLE_INSIGHTS` — no row in `homigo_db`, absent = off

### What existed already (discovery)

Five capabilities were each explaining themselves in their own shape:

| Type | Has freshness | Has confidence | Has weight |
|---|---|---|---|
| `ZoneReason` | no | no | yes |
| `CoachReason` | no | no | no |
| `ShiftReason` | **yes** | no | no |
| `MetricEvidence` | no | **yes** | no |
| `ZoneSurgeDecision` | via signalState | **yes** | no |

They agree on most fields and differ exactly where it matters. A partner asking "why?" would have
received five differently-shaped answers depending on the screen.

### The design: projection, not replacement

`InsightEvidence` / `ExplainableInsight` in `partner-insight-evidence.types.ts` is a **canonical
projection**. Each capability keeps its own contract, rules version and tests; six adapters in
`partner-insight-explainer.service.ts` re-express what was already computed. A test asserts the
explainer contains no `Math.round`, `Math.max`, `reduce(`, `sort(` or percentage arithmetic — it
cannot compute a score, rank or amount even by accident.

**Items 0-7 were not modified.**

### Scope — the guard against a specific lie

`EvidenceScope` is `PARTNER_SPECIFIC | ZONE_SPECIFIC | PLATFORM_WIDE`, assigned per signal, and
`insightScope()` **derives** the insight's scope from evidence that actually contributed. A
partner-specific fact that was unavailable cannot make an insight personal.

Verified on real data: the zone insight returned `ZONE_RANKING_PLATFORM_ONLY`, scope
`ZONE_SPECIFIC`, statement *"This ranking comes from platform-wide demand and supply, not from your
own history"* — because `TRAVEL` was `UNAVAILABLE` and `PARTNER_HISTORY` was
`INSUFFICIENT_HISTORY`. This is the "your best zone" overstatement being refused on live data.

### Prose is generated from codes, never the reverse

`STATEMENTS` maps reason code to sentence. Tests assert no statement contains
`you will earn` / `guaranteed` / `pays more` / `higher pay` / `bonus`, and none contains
`because` / `caused` / `due to` / `as a result of` / `leads to`. An unknown code yields
`EVIDENCE_UNAVAILABLE` — an explicit admission, never invented prose.

**LLM:** entirely absent from the path. The deterministic explanation is the only explanation; a
test asserts no gateway or provider reference exists in the service.

### The two negative tests the directive asked for

- **Changing the prose leaves evidence untouched** — the evidence array is compared before and after
  the statement is replaced, proving prose is never an input.
- **Removing required evidence degrades rather than substitutes** — `GROUNDED` becomes `INCOMPLETE`
  becomes `UNAVAILABLE`, and the removed fact stays `null` with a reason code. Never backfilled.

### A real defect found and fixed (mine)

The morning-brief adapter wrote `value: sig.value === null ? null : signal`, putting the signal's own
**name** where a measurement belonged — a test reading it found the string `"DEMAND"`. The eight
brief signals carry heterogeneous payloads that do not fit `number | string`, so the honest answer is
that a brief-level explanation reports availability and freshness, not values; measurements belong to
the per-capability insights where they have a unit and a definition. `value` is now always `null`
there, with a definition saying so.

A second test was added from the same investigation: a **STALE capability signal keeps its
measurement** rather than being blanked, because erasing an aged number is a different lie from
presenting it as current.

### Security

Operator free text (zone and service names) is sanitised through the platform's existing
`sanitizeInput` at the point evidence is built, not at render time, so every consumer receives an
already-safe value. Tests cover prompt injection detection, markup stripping, null/empty labels
staying null, no actor/role/admin parameter existing to spoof, and no private identifier appearing in
a serialised insight.

### Certification path

Explainable Insights is **not a workflow** — it has no trigger, no notification step and no shadow
execution. It is a read-only projection consumed by capabilities that carry their own certification
state. It therefore does not enter the automation certification gate, and no new certification
framework was created.

### Real observation

One real eligible partner from `homigo_db`, read-only, all six adapters:

```
ZONE      ZONE_RANKING_PLATFORM_ONLY  scope=ZONE_SPECIFIC     state=INCOMPLETE   conf=0.55
EARNINGS  EARNINGS_INSUFFICIENT_HISTORY scope=PLATFORM_WIDE   state=UNAVAILABLE  conf=null
SHIFT     SHIFT_NO_WINDOWS            scope=PARTNER_SPECIFIC  state=INCOMPLETE   conf=0.24
NUDGE     none (INSUFFICIENT_HISTORY) — correctly produces no insight
SURGE     SURGE_NOT_EVALUATED         scope=ZONE_SPECIFIC     state=GROUNDED     conf=0.7
MORNING   MORNING_BRIEF_PARTIAL       scope=PARTNER_SPECIFIC  state=INCOMPLETE   conf=0.12
```

Latency **1476 ms** for six capabilities plus six explanations (the capabilities dominate; the
projection is arithmetic-free). **No cache was added** — no measurement justified one.

**Side effects: ZERO** — 9 counters identical.

### Files

| Artifact | Path |
|---|---|
| Canonical contract | `apps/backend/src/services/partner-insight-evidence.types.ts` |
| Six adapters | `apps/backend/src/services/partner-insight-explainer.service.ts` |
| Tests (29 / 278 assertions) | `apps/backend/src/__tests__/explainable-insights.integration.test.ts` |

No existing file was modified.

### Failures found and classified

- `APPLICATION_DEFECT` (mine, fixed) — meaningless `value` in the morning-brief adapter, above.
- No others. No `UNKNOWN`.

### Regression

backend typecheck **0** · partner-web typecheck **0** · **289 pass / 0 fail / 1718 assertions**
across 13 suites · AI catalog 57 tools (31/12/14), **HIGH_RISK 0/14 bound**.

**Type suppressions: 0 in code.** A raw grep reported 1; the match was inside a comment explaining
why `as unknown as` was *not* used. Counted again with comments stripped: 0 across all three files.
(`as unknown as` was written once during authoring and removed — `Signal<unknown>` is both the
honest annotation and the one that compiles.)

### UI

**Not built.** The contract is backend-complete and consumable, but no partner-facing "Why this?"
component was added. Recorded as `POST_PHASE_FOLLOWUP` rather than claimed: the directive's
completion criteria are about the evidence contract, grounding, security, determinism and real-data
verification — all met — and building UI was explicitly to be done by extending existing components,
which is a separate piece of work with its own design review.
