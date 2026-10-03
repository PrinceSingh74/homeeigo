# PHASE 12 — Final Forensic Closure

## U. Final verdict

### `PHASE_12_OPERATIONAL_WITH_DATA_LIMITATIONS`

Not `PHASE_12_COMPLETE`. The engineering is complete and every in-scope technical defect is repaired,
but the ML platform cannot advance: **BigQuery billing is disabled**, so no model can be trained, the
ETL cannot run, and the warehouse registry cannot be written. That is infrastructure, not code.

This pass treated `PHASE_12_FINAL_RECONCILIATION.md` as a claim rather than as truth, and **it did not
survive**. Its central cross-path statement was backwards, and the audit found five further defects —
two of them in code written by that same pass.

Measured 2026-09-04. Every figure below came from a command run in this pass.

---

## A. Previous claim vs current reality

| Previous claim | Reality found |
|---|---|
| "`vertex-ai.service.forecastDemand()` … touches a Phase-4 serving surface with **six consumers**" | It has **eight**, and the count was attached to the wrong service. The six-consumer note belonged to `analytics/forecast/demand-forecast.service.ts`, which actually has **one** (the analytics route). |
| "Consolidating them … was out of scope" | Wrong path was guarded. The pass guarded the **1-consumer** path and left the **8-consumer** path — surge pricing, digital twin, AI tool handler, ML boundary, partner UI, admin dashboards — completely unguarded. |
| "One duplicate inference path remains, disclosed" | Disclosure was accurate; the impact assessment was not. The unguarded path is the one users actually see. |
| Demand fallback forecaster is the safe path | The fallback **itself produced a past window** — it forecast forward from the last *observed* day, so with the series 22 days stale it returned 2026-08-14…2026-08-20 and called it a forecast. |
| ML platform health is operational | `health()` **threw** on any database without the Phase-12 migration — including production — instead of degrading. |

The rest of the previous report held: the billing blocker, the leakage findings, the readiness
verdicts, the registry invariants and the production-safety claims all re-verified.

---

## B. Every defect found

| # | Defect | Severity | Where |
|---|---|---|---|
| D1 | The 8-consumer demand path returned an expired forecast stamped `freshness: <now>` and `source: bigquery:arima_plus` | **Critical** | `geo-intelligence.service.demandForecast()` |
| D2 | Surge pricing derived a trend slope across expired hours and reported "rising"/"falling" | **High** — money-adjacent | `dynamic-pricing.service.surgeForecast()` |
| D3 | The digital twin summed expired points into a city's 1h/6h/24h demand figures | **High** | `digital-twin.service.cityTwin()` |
| D4 | The partner-facing page charted June hours labelled by hour-of-day only, under "24-hour warehouse forecast" | **High** — user-visible | `partner-web …/ai-hq/demand-forecast` |
| D5 | The admin AI HQ dashboard charted the same points as sparkbars with no dates | **Medium** | `AiHqDashboard.tsx` |
| D6 | The deterministic fallback forecaster produced a **past** window | **High** — the fallback committed the error it exists to prevent | `demand-baseline.service.forecast()` |
| D7 | `mlPlatformHealthService.health()` threw when the governance tables were absent | **Medium** | `ml-platform-health.service.ts` |
| D8 | Admin twin page would render withheld figures as `0` (`formatNumber(null) → "0"`, `Math.min(100, null) → 0`) | **Medium** | `digital-twin/page.tsx` |

D6 and D7 were introduced by the previous Phase-12 pass. D6 was caught by an E2E assertion, not by
review — "every forecast point is in the future" is the kind of property a reader accepts on sight
and a test does not.

---

## C. Every defect fixed

**D1 — one guard, at the source.** A canonical staleness definition already existed:
`isDemandForecastStale(observedAt, value, now)` in `shift-planning.service.ts`, with
`DEMAND_STALE_AFTER_HOURS = 24`. Five consumers already used it; five did not. Rather than add five
copies of the check, the check now happens **once, in `demandForecast()`**, so a consumer cannot
forget it and two consumers cannot disagree about the same forecast. No new abstraction was created —
the existing helper is imported.

The result now carries `stale`, `forecastWindow {from,to}`, `expiredByHours`, `staleAfterHours` and
`limitations`. When the window has passed, `confidence` is floored to **0** (a stale forecast is about
the wrong days, not an uncertain one) and `source` becomes `bigquery:arima_plus:expired_horizon`, so a
consumer that surfaces `source` as `modelVersion` cannot read it as current.

The points are still returned — deliberately. The five consumers that already read them and run the
helper themselves keep working unchanged, and an operator debugging the warehouse needs to see what
the model actually said.

**D2** — surge computes the slope only when the forecast is usable; otherwise `trend: "unknown"`,
`trendBasis: "UNAVAILABLE_STALE_FORECAST"`, confidence 0. `current` is untouched: it comes from live
zone signals, not the forecast.

**D3, D8** — the twin **withholds** rather than zeroing: `forecast1h/6h/24h: null` plus
`forecastUnavailableReason: "DEMAND_FORECAST_STALE"`. A 0 reads as "no demand expected", which is a
prediction nobody made. The admin page renders `—`, drops withheld points from the series rather than
plotting them at the floor, and omits the meter.

**D4, D5** — both UIs refuse to chart an expired window and say why, naming the window end. Live
supply-demand gaps are unaffected and still shown.

**D6** — the baseline now forecasts from **today**, not from the last observation, and declares the
gap: *"The last observation is 22 days old, so every forecast day carries the level from 2026-08-13
across a 22-day gap. This is an extrapolation, not a measurement of recent demand."*

**D7** — an absent governance registry degrades to `UNKNOWN` with the warehouse-production count still
reported, instead of taking the endpoint down.

---

## D. Demand cross-path audit

| Path | Consumers | Guard before | Guard now |
|---|---|---|---|
| `vertex-ai.forecastDemand()` → `geoIntelligenceService.demandForecast()` | **8** | none | **at the source** |
| `analytics/forecast/demand-forecast.service.ts` | 1 (`/api/analytics/*`) | expired-horizon refusal + fallback | unchanged |

**The eight consumers of the previously-unguarded path:**

| Consumer | Renders points? | State |
|---|---|---|
| `/api/geo-intel/demand-forecast` (route) | passthrough | inherits guard |
| `ai/ml-boundary.ts` | passthrough | inherits guard — verified |
| `ai-tools …/handlers/index.ts` (`read.admin.getForecast`) | passthrough | inherits guard |
| `dynamic-pricing.surgeForecast()` | derives slope | **fixed** — trend `unknown` |
| `digital-twin.cityTwin()` | sums into figures | **fixed** — withholds |
| `demand-supply-warning.service` | already guarded | unchanged |
| `executive-intelligence.service` | already guarded | unchanged |
| `forecast-explainer.service` | already guarded | unchanged |

**Frontend consumers, swept separately:**

| Surface | Finding |
|---|---|
| `partner-web …/ai-hq/demand-forecast` | charted June as the coming 24h — **fixed** |
| `admin AiHqDashboard` | sparkbars, no dates — **fixed** |
| `admin digital-twin page` | would render `0` — **fixed** |
| `admin command-center → AiIntelligencePanel` | accepts a `demand` prop and **never uses it** — verified, no fix needed |
| `partner use-partner-intelligence` | exposes `demand`; no page renders it — verified |

**Other model paths, verified:**

- `predictEta()` → `ML.PREDICT(model_eta)`. `model_eta` **does not exist** among the 7 BQML artifacts;
  the call throws, returns `null`, and the caller falls back to the Google route with an honest
  `source`. Safe by construction.
- `geoIntelligenceService.revenueForecast()` is **not** a model — a Postgres run-rate projection,
  correctly labelled `source: "postgres"`. Note: the warehouse's `model_revenue_forecast` is marked
  production and has **no consumer at all**.

**Measured after the fix:**

```
source      : bigquery:arima_plus:expired_horizon
confidence  : 0
stale       : true
window      : 2026-06-20 06:00 .. 2026-06-21 05:00
expiredBy   : 1803 hours
limitations : 2
```

---

## E. Model readiness matrix

| Model | Data | Label | Features | Training | Evaluation | Candidate | Shadow | Approval | Production | Monitoring | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Demand | `UNTRUSTED` | ✓ | ✓ | blocked (billing) | ✓ holdout | ✓ baseline | ✓ replayed | ready | none | ✓ | `READINESS_ONLY` |
| ETA | `INSUFFICIENT` | 64/65 duration, **7/65 distance** | partial | blocked | — | — | — | — | never | ✓ | `DATA_INSUFFICIENT` |
| Churn | `INSUFFICIENT` | **leaks** | leaks | blocked | — | — | — | — | never | ✓ | `HUMAN_DECISION_REQUIRED` |
| CLV | `INSUFFICIENT` | **leaks** | leaks | artifact exists | invalid | — | — | — | staging | ✓ | `DATA_INSUFFICIENT` |
| Provider LTR | `INSUFFICIENT` | none | ✓ | n/a | — | — | — | — | rules | ✓ | `KEEP_EXISTING` |
| Recommendations | `INSUFFICIENT` | none | weak | n/a | — | — | — | — | rules | ✓ | `DATA_INSUFFICIENT` |
| GPS Fraud | `INSUFFICIENT` | rule echo | ✓ | n/a | — | — | — | — | rules | ✓ | `KEEP_EXISTING` |
| Support ML | `INSUFFICIENT` | none | ✓ | n/a | — | — | — | — | LLM | ✓ | `KEEP_EXISTING` |

---

## F. Data readiness — re-measured this pass

| Model | Readiness | Evidence |
|---|---|---|
| Demand | `DATA_UNTRUSTED` | 50 observed days / 66 calendar, 13 duplicate dates, 303 bookings, 1 zone, **22 days stale**, mean 6.06/day |
| ETA | `DATA_INSUFFICIENT` | 65 labels · 41 validated · **2 training-ready** (gate 50) · 64 with duration · **7 with distance** · 33 partners |
| Churn | `DATA_INSUFFICIENT` | 22 customers · 15 churned · **22/22 label reconstructed from feature** |
| CLV | `DATA_INSUFFICIENT` | 22 customers · **22/22 target reconstructed** · 15 zero-revenue · 12 repeat |
| Provider LTR | `DATA_INSUFFICIENT` | 1,043 score rows · 2,837 attempts · 224 accepted (7.9%) |
| Recommendations | `DATA_INSUFFICIENT` | 19 ratings · 124 customers · 30 repeat · 37 services |
| GPS Fraud | `DATA_INSUFFICIENT` | 501 pings · 15 signals · 16 resolved incidents |
| Support ML | `DATA_INSUFFICIENT` | 32 tickets · 7 categories · 8 resolved |

**Zero models are `DATA_READY`.** Readiness is computed from live row counts on every call, never
stored, so it cannot go stale and a reviewer who disagrees can re-run it.

---

## G. Leakage audit

Both findings re-confirmed by counting, not by reading:

- **CLV — `TARGET_RECONSTRUCTION`, 22/22 rows.** `avg_order_value = lifetime_revenue / completed`, and
  `lifetime_revenue` is the label, so the target is recovered exactly as `avg_order_value × completed`.
  **This is the mechanism behind the recorded R² of 0.9994** — an algebraic identity, not customer
  value. Not trained.
- **Churn — `LABEL_DEFINING_FEATURE`, 22/22 rows**, plus `NON_REPRODUCIBLE_DEFINITION`: the label is
  `IF(recency_days >= 30, 1, 0)` where `recency_days` is a feature computed against `CURRENT_DATE()`,
  so it also changes daily. Not trained, not promoted.

Temporal splitting is enforced in the only evaluation that runs: split by date, never randomly, and
the incumbent is explicitly **not scored** because its training window overlaps the test window.

---

## H. MLOps lifecycle

`DATA → QUALITY → TRAIN → EVALUATE → CANDIDATE → SHADOW → HUMAN APPROVAL → PRODUCTION → DRIFT`, with
no blind transition. Proven end to end: **20/20 stages**, re-run fresh this pass.

## I. Candidate / shadow

One candidate: `demand_forecast_baseline`, `NAIVE_LAST_OBSERVED`, selected because it **won a
measurement** — MAE 1.6429 vs seasonal-naive 2.9286, median 2.6429, mean 4.4780 on a 14-day temporal
holdout. Shadow reported `CANDIDATE_ONLY`: 14 settled days, **0 comparable**, because the incumbent's
horizon had expired 68 days before the window and produced nothing. An unopposed candidate is not
called better. Outcomes settle once and cannot be rewritten (verified: re-settle → `skipped: 14`).

## J. Approval / promotion

No code path from TRAINED to PRODUCTION. Registering into `PRODUCTION`/`APPROVED`, transitioning to
either, promoting without approval, approving with a token note, and approving a version with **no
metrics** are all refused with typed codes. Approval records who/when/why and does **not** promote —
promotion is a separate act.

## K. Rollback

Target is `supersededVersionId`, recorded at promotion time, not inferred from version numbers.
Promotion and demotion happen in one transaction. Proven: v1 → promote → v2 supersedes v1 → rollback →
**v1 serving again**. "One PRODUCTION per model" is a partial unique index — a direct INSERT was
**rejected by the database**, not by an `if`.

## L. Drift

Four checks, computed on demand: `etl_pipeline`, `warehouse_freshness`, `forecast_horizon`,
`registry_reconciliation`. Measured against production this pass:

```
[FAIL] etl_pipeline          last success 2026-08-19 (15d), 430 failures since, 18 jobs
[FAIL] warehouse_freshness   newest booking 22 days old
[FAIL] forecast_horizon      forecasts to 2026-06-27, expired 69 days, 165/168 negative lower bounds
[UNKNOWN] registry_recon.    governance registry absent in this database; 4 warehouse models marked production
serviceable: false
```

No statistical drift thresholds were invented — PSI/KL alerting stays `HUMAN_DECISION_REQUIRED`.

## M. Serving

Every prediction response identifies its real source. `warehouse` / `deterministic_fallback` / `none`
on the analytics path; `bigquery:arima_plus` / `…:expired_horizon` on the geo-intel path;
`bqml` / `google:distance_matrix` / `haversine` for ETA. A caller error (unknown scope) is **not**
answered with a fallback — that would hide the mistake.

## N. Whole-project consumers

Swept: backend services, routes, AI tools, ML boundary, admin panel, partner web, customer web,
both mobile apps. Every consumer of demand output is listed in §D with its state. No hidden second
path remains: the only two ML.FORECAST call sites are the two named, and both are guarded.

## O. Security

RBAC unchanged and re-verified: reads `ANALYTICS/READ`, registration/transition `SETTINGS/UPDATE`,
approval/promotion/rollback `SETTINGS/APPROVE`, unmapped governance routes denied by default. No
training data, feature row or customer record is returned by any route. ML output remains advisory —
no finance, booking, dispatch or fraud write exists in any Phase-12 path.

## P. Database safety

| Question | Answer |
|---|---|
| Phase-12 tables in `homigo_db` | **0** |
| `MlModelStage` enum in `homigo_db` | **absent** |
| Business tables mutated | **No** — bookings 497, payments 302, ledger 1792, wallet 45, users 723, unchanged |
| Latest `homigo_db` booking | 2026-09-03 20:29 — predates this pass |
| Probe rows left in `homigo_p39` | **0 versions, 0 shadow** |
| BigQuery mutated | **No** — billing disabled; writes rejected by GCP |
| Model promoted anywhere real | **No** |

---

## Q. Regression — fresh

| Check | Result |
|---|---|
| Backend typecheck | **exit 0** |
| Admin typecheck | **exit 0** |
| Partner-web typecheck | **exit 0** |
| Admin clean build | **exit 0** — "Compiled successfully" |
| Partner-web clean build | **exit 0** — "Compiled successfully in 68s" |
| Phase-12 governance + cross-path suites | **59 pass / 0 fail / 242 assertions** |
| Governed lifecycle E2E | **20 / 20 stages** |
| Demand cross-path E2E | **15 / 15 checks** |
| Full backend suite, 129 files | **1866 pass / 15 fail** |

---

## R. Pre-existing failures — classified by evidence, not assertion

The full suite was run **twice on the identical tree**:

| Run | Duration | Pass | Fail | Failing suite groups |
|---|---|---|---|---|
| 1 | 1006 s | 1811 | 36 | 13 |
| 2 | 400 s | 1866 | **15** | 6 |

**Same code, same files, 36 vs 15 failures.** The failing set is non-deterministic and
load-dependent. Run 2's six groups are a strict **subset** of run 1's thirteen, and every
business-state assertion that failed in the slow run — *"reading intelligence mutates nothing"*,
*"nothing in this suite touched the business"*, *"provenance and side effects"*, *"an approval spent
against an unbound tool…"* — **passed** in the fast one, and passes in isolation (86/86 across those
three files).

The persistent core, present in both runs and in Phase 11's, is Postgres-deadlock concurrency work:
`chaos-certification`, `enterprise-scalability-certification`, `money-matrix-certification`,
`release-blocker-elimination`, `failure-recovery-certification`. Under contention they deadlock, leave
rows behind, and the "nothing moved" assertions elsewhere then catch that contamination.

A clean-tree run (my three modified services stashed, my new test file set aside) failed a comparable
set including *"boundaries and side effects"*, *"a simulation stays a simulation"* and *"confidence
carries its provenance"* — **without any of my changes present**. That run was cut short by a session
restart and its total is not quoted.

**Zero ML, knowledge, RBAC, gateway or cross-path failures in either complete run.** Phase 12 changed
no file any of those suites imports.

---

## S. Human decisions

| Decision | Why it cannot be inferred |
|---|---|
| `CHURN_DEFINITION_HUMAN_DECISION_REQUIRED` | The label is a function of a feature and moves daily |
| `RETRAINING_CADENCE_HUMAN_DECISION_REQUIRED` | No policy exists; a scheduler may execute one, not invent it |
| `DRIFT_THRESHOLD_HUMAN_DECISION_REQUIRED` | Measurement built; alert magnitude is a policy call |
| `DEMAND_MODEL_RETIREMENT_HUMAN_DECISION_REQUIRED` | Naive beats it and its horizon expired; retire/retrain is governance |
| `ZONE_GRANULARITY_HUMAN_DECISION_REQUIRED` | 7 zones exist; all demand is `unzoned` |
| `ORPHAN_MODEL_HUMAN_DECISION_REQUIRED` | `model_revenue_forecast` is marked production with **no consumer** |

## T. External / infrastructure blockers

| Blocker | Effect |
|---|---|
| **BigQuery billing disabled** | Root cause. No training, no ETL, no warehouse write. Everything else follows. |
| ETA travel-distance capture | 7 of 65 labels carry it |
| Adjudicated fraud outcomes | None |
| Impression/exposure log | Absent — blocks recommendations and LTR |
| Human-labelled support tickets | Absent |
| Migration on `homigo_db` | Deliberately not applied |

---

## Scope closure

Every Phase-12 requirement has a final state. No `UNKNOWN` remains. No model was trained to make the
roster look fuller, no metric was fabricated, no threshold was invented, no blind promotion exists,
no duplicate ML engine was created, and production was not mutated.

No Capability 13. No Phase 12.1. No unrelated refactors.

---

*Closed 2026-09-04. The previous Phase-12 report was re-audited from zero and its central cross-path
claim was found backwards — the guarded path had one consumer, the unguarded one had eight, including
surge pricing and a partner-facing page. Eight defects were found, two of them introduced by that same
pass, and all eight are repaired and verified. The regression classification is backed by two runs on
an identical tree producing 36 and 15 failures respectively, which is what non-determinism looks like
when it is measured rather than asserted.*
