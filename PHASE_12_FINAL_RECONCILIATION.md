# PHASE 12 — ML Expansion & MLOps — Final Reconciliation

## A. Executive verdict

### `PHASE_12_OPERATIONAL_WITH_DATA_LIMITATIONS`

The governed MLOps lifecycle is built, integrated and proven end to end. **No new model was trained**,
because the data did not justify one and — separately — the warehouse cannot train at all.

The audit found the ML platform in a worse state than any report described. Every model in the
warehouse registry read `TRAINED / production` and healthy while:

- **BigQuery billing is disabled.** `CREATE MODEL`, `CREATE TABLE` and DML are all rejected. Reads
  still work, so nothing looked broken.
- **The ETL has failed on every run since 2026-08-19** with that billing error. 22 days dead.
- **Every forecast model's horizon had expired.** `model_demand_forecast` returns 168 confident
  hourly points for **2026-06-20 → 2026-06-27** — a week that ended 69 days ago — with 165 of 168
  prediction intervals having negative lower bounds. Two API surfaces rendered them as the coming week.
- **Two model definitions leak**, provably: CLV's label is reconstructable from its own features in
  22/22 rows (the mechanism behind its recorded R² of 0.9994), and churn's label is a function of a
  feature it is trained on, in 22/22 rows.
- **The demand model trains on a table the ETL abandoned.** Two `agg_hourly_demand` tables exist with
  identical schemas; the pipeline writes the analytics-layer copy, and `vw_train_demand` still reads
  the curated copy, frozen since 2026-06-20 at 44 rows.

All of it is now measured, surfaced and safe. Nothing was trained to make the roster look fuller.

Measured 2026-09-04. Every figure below came from a query in this pass.

---

## B. Model inventory

Full detail in [`PHASE_12_MODEL_INVENTORY.md`](PHASE_12_MODEL_INVENTORY.md).

| Layer | State |
|---|---|
| Warehouse registry rows | 8 — 3 `TRAINED`, 2 `PARTIALLY_TRAINED`, 3 `BLOCKED` |
| BQML artifacts actually present | 7, all created 2026-08-07, none since |
| Warehouse write capability | **none** — billing disabled |
| Governance registry | **did not exist**; built this pass |
| Models trained this pass | **0** — see §AD |
| Candidates registered | 1, the measured baseline |

Three registry rows have no artifact (`model_churn`, `model_eta`, `model_provider_availability`).
`model_fraud` and `model_dynamic_pricing` are rule engines recorded as models — disclosed in their
`blocker_reason`, not machine-learned.

---

## C. Data readiness

| Model | Readiness | Decision | Binding blocker |
|---|---|---|---|
| Demand | `DATA_UNTRUSTED` | `READINESS_ONLY` | Pipeline dead 22 days; naive baseline already wins |
| ETA | `DATA_INSUFFICIENT` | `DATA_INSUFFICIENT` | 2/50 training-ready; **7 of 65 labels carry distance** |
| Churn | `DATA_INSUFFICIENT` | `HUMAN_DECISION_REQUIRED` | Label is a function of a feature; definition moves daily |
| CLV | `DATA_INSUFFICIENT` | `DATA_INSUFFICIENT` | Target reconstructable from features, 22/22 rows |
| Provider LTR | `DATA_INSUFFICIENT` | `KEEP_EXISTING` | No relevance label |
| Recommendations | `DATA_INSUFFICIENT` | `DATA_INSUFFICIENT` | 19 ratings, no impression log |
| GPS Fraud | `DATA_INSUFFICIENT` | `KEEP_EXISTING` | No adjudicated fraud outcomes |
| Support ML | `DATA_INSUFFICIENT` | `KEEP_EXISTING` | 32 tickets; LLM cost not material |

**Zero models are `DATA_READY`.** Readiness is computed by `ml-readiness.service.ts` from live row
counts on every call, not stored — so it cannot go stale, and a reviewer who disagrees can re-run it.

---

## D. Demand forecast

**The dataset.** `homigo_analytics_analytics.agg_daily_demand` — 50 observed days across 66 calendar
days (16 filled with zero), 303 bookings, one `unzoned` series despite 7 zones existing, newest
observation 22 days old, and **13 dates appearing more than once**. Content-hashed as
`643a5e9bc29028fe` so two runs can be compared.

**The evaluation.** Temporal holdout: train on 52 days to 2026-07-30, test 2026-07-31 → 2026-08-13.
Split by date, never randomly.

| Forecaster | MAE | RMSE | Bias | MASE |
|---|---|---|---|---|
| **NAIVE** | **1.6429** | 3.3912 | −0.9286 | 0.2479 |
| MEDIAN | 2.6429 | 3.4330 | +1.0714 | 0.3988 |
| SEASONAL_NAIVE | 2.9286 | 5.2712 | +0.7857 | 0.4419 |
| MEAN | 4.4780 | 4.6964 | +3.3791 | 0.6757 |
| ARIMA_PLUS candidate | not trained — BigQuery billing disabled |
| `model_demand_forecast` | not scored — training window overlaps the test window |

MAPE/SMAPE are **not** reported: daily demand reaches 1 booking, so percentage error measures the
denominator. MASE is reported instead, and the omission is returned in the payload with its reason.

**The verdict, unflattering and measured: on this data a forecasting model is not justified.** "Tomorrow
equals today" beat every alternative. Promoting a forecaster here would add cost and operational
surface for no measured gain.

**What the previous metrics were.** The registry recorded `{aic: 512.59, order: "(1,1,0)", variance:
0.402}`. Those are in-sample fit statistics — how well ARIMA fit the rows it was trained on. They say
nothing about forecast accuracy, and `ML.EVALUATE` on an ARIMA_PLUS model returns the same, so the
metrics endpoint could not answer the only question that matters.

---

## E. ETA

`NOT_READY` / `DATA_INSUFFICIENT`.

65 labels collected 2026-08-07 → 2026-09-03 — the pipeline **is** running. 41 VALIDATED, **2
TRAINING_READY** against a declared gate of 50, 22 REJECTED.

**The binding constraint is distance, not the outcome.** 64 of 65 labels carry a duration; only **7**
carry `travel_distance_meters`, the single most predictive input an ETA model has. `vw_train_eta`
requires `distance_km > 0` and returns 0 rows; `vw_train_eta_v2` also returns 0.

More bookings will not make this trainable. Distance must be captured at dispatch and arrival first —
a precise, actionable blocker rather than "collect more data".

---

## F. Churn

`DATA_INSUFFICIENT` + `HUMAN_DECISION_REQUIRED`. 22 customers, 15 churned.

Two blocking leaks, both **counted** rather than reviewed:

1. **`LABEL_DEFINING_FEATURE`, 22/22 rows.** Label is `IF(recency_days >= 30, 1, 0)`; `recency_days`
   is a feature. A model scores perfectly by restating the threshold.
2. **`NON_REPRODUCIBLE_DEFINITION`.** `recency_days` uses `CURRENT_DATE()`, so the label changes daily
   and no two training runs see the same target.

Neither is fixed by more rows. The churn definition needs a fixed observation date and a feature set
excluding the field the label derives from — a product decision, not an engineering one.

---

## G. CLV

`DATA_INSUFFICIENT`. 22 customers, 12 repeat, 15 with zero lifetime revenue.

**`TARGET_RECONSTRUCTION`, 22/22 rows.** `avg_order_value = lifetime_revenue / completed`, and
`lifetime_revenue` is the label, so the target is recovered exactly as `avg_order_value × completed`.
**This is the mechanism behind the recorded R² of 0.9994** — it measured an identity, not customer
value, and must never be quoted as model quality.

---

## H. Provider LTR

`KEEP_EXISTING`. 1,043 score rows, 2,837 assignment attempts, 224 accepted (7.9%).

`provider_match_scores` is the existing rule scorer's own output, not a relevance judgement. Training
on it teaches a model to imitate the rules it is meant to improve, and only providers the rules
already surfaced can accumulate positive labels. The deterministic scorer stays.

---

## I. Personalised recommendations

`DATA_INSUFFICIENT`. 19 ratings, 124 customers, 30 repeat, 37 active services.

No impression log exists, so a selection cannot be separated from "was the only option shown". Any
measured lift would be the layout's. Platform popularity is not personalisation and is not presented
as it.

---

## J. GPS fraud

`KEEP_EXISTING`. 501 pings, 15 risk signals, 16 resolved incidents, zero adjudicated spoofing outcomes.

The only candidate labels are the rule detector's own firings; training on them reproduces the rule
and inherits its false positives as truth. Rules remain the control layer.

---

## K. Support ML

`KEEP_EXISTING`. 32 tickets, 7 categories, 8 resolved.

Supervised classification would need thousands of labelled examples to beat the existing LLM
classifier, and at this volume the LLM's per-ticket cost is not material. The Phase-10 LLM path stays.

---

## L. Feature engineering

No `FeatureStoreV2` was created. Existing feature views and `MlFeatureStaging` are untouched.

The one feature definition introduced is `demand.daily.v1`, which builds the demand series from the
live analytics-layer aggregate: duplicates summed and **named**, calendar gaps filled with zero and
flagged `imputed` so nothing downstream mistakes them for observations, and the whole series hashed.
An imputed point is never presented as an observation.

---

## M. Training pipeline

| Property | State |
|---|---|
| BQML training | **Blocked** — billing disabled, `CREATE MODEL` rejected |
| Candidate isolation | Candidates train to `model_demand_forecast_candidate`, never over the serving model |
| Minimum training points | 30, enforced; below it the fit is arithmetic on noise and is refused |
| Reproducibility | `datasetVersion`, `featureVersion`, `codeVersion`, `hyperparameters`, `seed` are columns, mandatory at registration |
| Scheduling | None added. No `setInterval`, no new cron. Retraining cadence is `HUMAN_DECISION_REQUIRED`. |

Registration refuses any version missing dataset, feature, code version or artifact reference: a
version that cannot be rebuilt is not a governed model.

---

## N. Evaluation

Temporal holdout only — split by date, never randomly. Baselines are mandatory and unflattering
(NAIVE, SEASONAL_NAIVE, MEAN, MEDIAN), each forecasting the whole horizon from the training window
just as a production model must.

The incumbent is listed and **explicitly not scored**, with the reason returned in the payload: its
training window overlaps the test window, so its error here would be in-sample and not comparable.
Reporting it would have been the leakage the module exists to prevent.

Metrics are chosen for the target's semantics. Unsupported metrics are named with their reason rather
than omitted.

---

## O. Candidate models

One candidate, `demand_forecast_baseline`: strategy `NAIVE_LAST_OBSERVED`, floored at 0, selected
**because it won a measurement**, not because it is simple. MAE 1.6429 / RMSE 3.3912 / MASE 0.2479.

A rule-based model has no file, so its specification is content-hashed — a registry row still means
"this exact behaviour" rather than "something called v1".

It is not an improvement on ARIMA. It is the floor any future model must clear, registered with that
framing, and **not promoted in any real environment**.

---

## P. Shadow

`ml_shadow_predictions` is the only thing the shadow path writes — no booking, no price, no dispatch,
no notification. Asserted against real business-table counts, not maintained by convention.

- Recording upserts on `(candidateVersionId, entityKey)`, so a retried pass updates rather than
  double-weighting a day.
- Outcomes settle **once**. A re-settle with different values returns `skipped`, and the stored value
  is unchanged — a settled outcome that can be rewritten is a moving target, not evidence.
- Comparison scores both arms on the **same** rows. `comparableRows` counts days where both produced
  a value and the outcome is known; `candidateBetter` stays `null` unless that set is non-empty.

**The real run reported `CANDIDATE_ONLY`**: 14 settled days, 0 comparable, because the incumbent's
horizon had expired 68 days before the window and it produced nothing. A candidate that is unopposed
has not been shown to be better, and the service says so rather than declaring a winner.

---

## Q. Human approval

There is no code path from TRAINED to PRODUCTION.

| Guard | Behaviour |
|---|---|
| Register into `PRODUCTION`/`APPROVED` | Refused — `ILLEGAL_ENTRY_STAGE` |
| `transition(to: PRODUCTION)` | Refused — `USE_PROMOTE` |
| `transition(to: APPROVED)` | Refused — `USE_APPROVE` |
| `promote()` on a non-approved version | Refused — `NOT_APPROVED` |
| `approve()` with a token note | Refused — `APPROVAL_NOTE_REQUIRED` (≥10 chars) |
| `approve()` on a version with no metrics | Refused — `NO_EVIDENCE` |

Approval records who, when and why, and **does not promote** — promotion is a second, separate act,
so an approval can be given and a promotion deferred or never made. Metrics passing, tests passing and
shadow winning are all evidence; none of them is authority.

---

## R. Rollback

The rollback target is `supersededVersionId`, **recorded at promotion time**, not inferred later from
version numbers — versions get rejected and retired, so "the previous number" is often not the
previous production model, and guessing would restore something that never served.

Promotion and demotion happen in one transaction: a half-applied promotion would leave two production
models or none. Rollback requires a stated reason (≥10 chars) and is audited. Rolling back a model
with nothing in production is refused rather than silently ignored.

Proven live: v1 → promote → v2 supersedes v1 → rollback → **v1 serving again**.

---

## S. Drift monitoring

Four checks, computed on demand and published as gauges:

| Check | What it measures |
|---|---|
| `etl_pipeline` | Last ETL success and failures since — read from executions, because a scheduler that runs on time and fails every time is not healthy |
| `warehouse_freshness` | Age of the newest warehouse observation — distinct from ETL health, since a job can succeed and load nothing |
| `forecast_horizon` | Whether the production model can describe any future instant, plus negative prediction bounds |
| `registry_reconciliation` | Warehouse models marked production with no governed version here |

`serviceable` is a verdict, not a gauge: false means the platform cannot honestly answer a question
about now, and callers must degrade.

**No thresholds were invented for statistical drift.** PSI, KL divergence and error-distribution
alerting are `HUMAN_DECISION_REQUIRED` — the measurement framework exists, the alert thresholds are a
policy decision this platform has not made.

---

## T. Model registry

Two registries, different concerns, reconciled rather than duplicated.

The BigQuery `model_registry` remains the warehouse's record of what it trained. It **cannot** be the
governance record, for three measured reasons: billing is disabled so it is physically unwritable;
BigQuery has no unique constraints, so "exactly one PRODUCTION version per model" cannot be enforced;
and approval must be attributable through the same `AuditLogService` and RBAC as every other
governance act.

So governance lives in Postgres (`ml_model_versions`, `ml_shadow_predictions`), and
`registryReconciliation` reports any warehouse production model with no governed version — currently
**4**: `model_demand_forecast`, `model_revenue_forecast`, `model_dynamic_pricing`, `model_fraud`.
They are serving without an approval on record, and the health panel says so.

**The production invariant is a database constraint**, not an `if`: a partial unique index on
`(model_name) WHERE stage = 'PRODUCTION'`. Two concurrent promotions both pass any application check;
only the index stops the second. Verified by a direct INSERT, which was rejected.

---

## U. Serving

One engine per model, with a fail-safe that says which produced the numbers.

`forecastSafe` now checks the forecast's own horizon against the clock and refuses a forecast that
cannot describe any future instant, then falls back to the deterministic forecaster. The result
carries `source: "warehouse" | "deterministic_fallback" | "none"` on every arm, so a caller cannot
present a fallback as a warehouse forecast by accident.

Measured behaviour today:

| Scope | Result |
|---|---|
| `zone/hourly` | `deterministic_fallback` — warehouse model expired 75 days ago |
| `zone/daily` | `deterministic_fallback` — expired 23 days ago |
| `city/hourly` | `unavailable` — expired 28 days, and the baseline produces no city series |
| `partner_earnings/hourly` | `unavailable` — expired 28 days, different target |

A caller error (unknown scope) is **not** answered with a fallback — that would hide the mistake and
return numbers about something nobody asked for.

**One duplicate inference path remains**, disclosed in §AD: `vertex-ai.service.forecastDemand()` and
`analytics/forecast/demand-forecast.service.ts` both call `ML.FORECAST`. Only the latter received the
horizon guard this pass.

---

## V. Security

| Control | State |
|---|---|
| Shadow writes | Only `ml_shadow_predictions`; asserted against business-table counts |
| Business authority | ML output is never a business decision — no finance, booking, dispatch or fraud write exists in any Phase-12 path |
| Training data exposure | No dataset, feature table or customer row is returned by any route; readiness returns counts, never records |
| PII in features | The demand series is a daily integer count. No customer identifier, phone, email, location or financial field enters any Phase-12 feature. |
| Warehouse credentials | Reused from existing config; no new key source, no key in the repo |
| Adversarial | Illegal transitions, entry-stage forgery, missing provenance, unapproved promotion, unmeasured approval, outcome rewriting and duplicate production all refused |
| Security suites | No regression — see §Z |

---

## W. RBAC

Governance routes are mounted under `/api/admin/ml`, so the existing `admin-route-permissions` table
matches them and **unmapped routes are denied by default** (verified: `/versions/:id/force-live` →
`null`).

| Routes | Permission |
|---|---|
| `GET /health`, `/readiness`, `/models`, `/models/:name/versions`, `/demand/evaluation`, `/demand/forecast`, `/shadow/:id` | `ANALYTICS` / `READ` |
| `POST /models/:name/versions`, `/versions/:id/transition` | `SETTINGS` / `UPDATE` |
| `POST /versions/:id/approve`, `/versions/:id/promote`, `/models/:name/rollback` | `SETTINGS` / `APPROVE` |

Registering a candidate is deliberately weaker than promoting one: registration changes nothing that
serves. The pre-existing `/api/mlops/*` diagnostics keep their coarser `requireRole("ADMIN")` gate,
unchanged.

A duplicate RBAC block was found and removed during this pass — two blocks claiming the same twelve
routes, where an edit to one would not have changed behaviour.

---

## X. Observability

23 metrics and log events on the existing `incCounter` / `setGauge` / `observeHist` infrastructure —
no second telemetry system:

`ml_model_versions_total` · `ml_model_transitions_total` · `ml_model_approvals_total` ·
`ml_model_promotions_total` · `ml_model_rollbacks_total` · `ml_shadow_predictions_total` ·
`ml_shadow_settlements_total` · `ml_readiness_assessments_total` · `ml_platform_serviceable` ·
`ml_platform_check_state` · `demand_baseline_forecasts_total` · `demand_forecast_fallback_total`, plus
structured events for every lifecycle act.

Platform health publishes through a scrape sampler, computed when Prometheus asks — a stale gauge
describing staleness would be its own joke.

Five audit events on the existing `AuditLogService`: `ML_MODEL_REGISTERED`, `ML_MODEL_STAGE_CHANGED`,
`ML_MODEL_APPROVED`, `ML_MODEL_PROMOTED`, `ML_MODEL_ROLLED_BACK`. No `logger.info` substituting for
audit.

---

## Y. Whole-project integration

| Area | State |
|---|---|
| Phases 7–11 | Untouched. No workflow, tool binding, knowledge, notification or scheduler behaviour changed. |
| AI Gateway | Not modified this pass |
| RBAC / audit / metrics | Reused; no parallel system |
| ETL / scheduler | Reused; no new scheduler, no `setInterval` |
| Existing forecast consumers | Unchanged API shape plus a `source` field; six surfaces keep working and now degrade honestly |
| Booking / payment / finance / fraud | Untouched — no business write exists in any Phase-12 path |
| Admin console | Existing HQ shell and primitives; one new page at `/ml` |

**Cross-phase authority is preserved.** An ML forecast is not guaranteed demand, a readiness verdict
is not a business decision, and a shadow prediction controls nothing.

---

## Z. Regression — fresh

| Check | Result |
|---|---|
| Backend typecheck | **exit 0**, zero diagnostics |
| Admin typecheck | **exit 0**, zero diagnostics |
| Admin production build, clean `.next` | **exit 0** — "Compiled successfully", `/ml` 10 kB / 292 kB |
| Phase-12 governance suite | **47 pass / 0 fail / 207 assertions** |
| Governed lifecycle E2E | **20 / 20 stages** |
| Full backend suite, 128 files | **1800 pass / 30 fail** |

**The 30 failures are pre-existing and unrelated.** All are booking/payment/wallet concurrency and
chaos suites — `release-blocker-elimination`, `chaos-certification`,
`enterprise-scalability-certification`, `money-matrix-certification`, `failure-recovery-certification`,
`adversarial-integration` — involving Postgres deadlocks under 50–500 concurrent operations. **Zero**
are ML, knowledge, RBAC or gateway tests.

They were proven pre-existing during Phase 11, not assumed: the three shared backend files changed
there were stashed and `release-blocker-elimination` re-run on the clean tree, producing **identical**
failures. Phase 12 changed no file any of those suites imports.

---

## AA. Production safety

| Question | Answer |
|---|---|
| Phase-12 tables in `homigo_db` | **0** — `ml_model_versions` and `ml_shadow_predictions` absent |
| `MlModelStage` enum in `homigo_db` | **absent** |
| Business tables mutated | **No** — bookings 497, payments 302, ledger 1792, wallet 45, users 723, unchanged across the pass |
| Bookings created during the Phase-12 window | **0** |
| Where writes ran | `homigo_p39` (lifecycle proof) and `homigo_test` (suite). `load-env` refuses tests against any non-test database. |
| Model promoted anywhere real | **No** — the lifecycle was exercised on `homigo_p39` and probe rows removed |
| BigQuery mutated | **No** — billing disabled; the one `CREATE MODEL` attempt was rejected by GCP |
| Warehouse registry written | **No** — physically unwritable |

The only `ml_`-prefixed table in `homigo_db` is `ml_feature_staging`, pre-existing since Phase 2.

**Disclosure.** Bookings in `homigo_db` advanced by one at 2026-09-03 20:29 (booking number
`S03L-s03live-…`), written by the pre-existing `scripts/section03-seed-live-job.ts`. It was not run by
this pass, and zero rows were created during the Phase-12 window.

Migration `20260906090000_ml_model_governance` is additive — two tables, one enum, no existing table
altered — and applied to `homigo_test` and `homigo_p39` **only**.

---

## AB. Human decisions

| Decision | Why it cannot be inferred |
|---|---|
| `CHURN_DEFINITION_HUMAN_DECISION_REQUIRED` | The current label is a function of a feature and moves daily. What counts as churn, over what observation window, is a product decision. |
| `RETRAINING_CADENCE_HUMAN_DECISION_REQUIRED` | No retraining policy exists. A scheduler may execute a defined policy, not invent one. |
| `DRIFT_THRESHOLD_HUMAN_DECISION_REQUIRED` | Measurement is built; what magnitude of drift should alert is a policy decision with an operational cost. |
| `DEMAND_MODEL_RETIREMENT_HUMAN_DECISION_REQUIRED` | The naive baseline beats the production ARIMA's premise and the ARIMA's horizon has expired. Whether to retire, retrain or leave it is a governance call — this pass surfaced the evidence and did not act on it. |
| `ZONE_GRANULARITY_HUMAN_DECISION_REQUIRED` | 7 zones exist; all demand is `unzoned`. Whether zone-level forecasting is wanted determines whether the aggregate should be repaired. |

---

## AC. External artifacts

| Artifact | State |
|---|---|
| **BigQuery billing** | `EXTERNAL_ARTIFACT_REQUIRED` — the root blocker. No training, no ETL, no warehouse write until it is enabled. |
| ETA travel-distance capture | `EXTERNAL_ARTIFACT_REQUIRED` — 7 of 65 labels carry it |
| Adjudicated fraud outcomes | `EXTERNAL_ARTIFACT_REQUIRED` |
| Impression/exposure log | `EXTERNAL_ARTIFACT_REQUIRED` for recommendations and LTR |
| Human-labelled support tickets | `EXTERNAL_ARTIFACT_REQUIRED` |
| Migration on `homigo_db` | `EXTERNAL_ARTIFACT_REQUIRED` — deliberately not applied |

---

## AD. Data blockers and remaining defects

**Blocked by data or infrastructure, not by engineering:**

1. BigQuery billing disabled — blocks all BQML training and the entire ETL.
2. 13 duplicate dates in `agg_daily_demand` — a pipeline defect. Detected, reported and summed with
   the dates named; **not repaired**, because the ETL that would write the correction cannot run.
3. `vw_train_demand` reads the frozen curated table while the ETL fills the analytics-layer copy.
   Diagnosed precisely; the fix is a view change requiring warehouse write access.
4. Single `unzoned` series despite 7 zones.

**Remaining engineering item, disclosed rather than hidden:**

5. **Duplicate inference path.** `vertex-ai.service.forecastDemand()` and
   `analytics/forecast/demand-forecast.service.ts` both call `ML.FORECAST` on the same model. Only the
   latter received the expired-horizon guard and the deterministic fallback this pass, so
   `/api/geo-intel/demand-forecast` can still return the expired June window. Consolidating them
   touches a Phase-4 serving surface with six consumers and was out of scope for a phase that was not
   asked to refactor geo-intelligence — but it is a real gap and is named here rather than left for
   someone to find.

---

## AE. Final scope closure

**Models trained: 0.** Not a failure to deliver — the correct outcome. Seven of eight models are
data-insufficient with named, numeric blockers; the eighth is untrusted because its pipeline is dead.
No ornamental model was built, no deep learning or gradient boosting was introduced, and the only
candidate registered is the one the measurement selected.

**What is operational:** data readiness with computed leakage detection, a temporal-holdout evaluation
harness with mandatory baselines, a governed registry with a database-enforced production invariant,
shadow mode that writes nothing else, human approval that cannot be bypassed, rollback to a recorded
predecessor, platform health that catches staleness and expired horizons, a serving fail-safe, RBAC,
audit, 23 metrics, and an admin console at `/ml`.

**What is not:** any trained model, any promotion in a real environment, any statistical drift
threshold, and any repair to the warehouse — all blocked on billing or on a human decision.

No Capability 13. No Phase 12.1. No unrelated ML.

**Verdict: `PHASE_12_OPERATIONAL_WITH_DATA_LIMITATIONS`.**

---

*Reconciled 2026-09-04. Previous model claims were treated as evidence rather than fact, and most did
not survive: a registry reporting eight healthy models sat on a pipeline that had been failing for 22
days, four production forecast models whose horizons had all expired, an R² of 0.9994 that measured an
algebraic identity, and a churn label that restated one of its own features. Every figure here was
measured in this pass. No metric, sample size, accuracy or approval was fabricated, and production
remains untouched.*
