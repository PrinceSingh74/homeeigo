# PHASE 12 — Model Inventory

Measured 2026-09-04 against the live warehouse (`homigo-497619.homigo_analytics`, asia-south1) and
`homigo_db` (read-only). Every figure came from a query in this pass.

---

## A. What actually exists

| Layer | State |
|---|---|
| BigQuery warehouse registry (`model_registry`) | 8 rows — 3 `TRAINED`, 2 `PARTIALLY_TRAINED`, 3 `BLOCKED` |
| BQML model artifacts actually present | **7**, every one created 2026-08-07, none since |
| BigQuery write capability | **NONE** — billing disabled; `CREATE MODEL`, `CREATE TABLE` and DML all rejected |
| ETL pipeline | **FAILING** on every run since 2026-08-19; last success 2026-08-19 |
| Warehouse data freshness | newest booking **2026-08-13**, 22 days stale |
| Governance registry (candidate → shadow → approval → rollback) | **did not exist**; built this pass in Postgres |

Three warehouse registry rows have no artifact at all: `model_churn`, `model_eta`,
`model_provider_availability` are `BLOCKED` with no model created. `model_fraud` and
`model_dynamic_pricing` are recorded as models but are rule engines — disclosed in their
`blocker_reason`, and not machine-learned.

---

## B. Model-by-model

### demand_forecast

| Field | Value |
|---|---|
| Purpose | Forecast booking volume |
| Data source | `homigo_analytics_analytics.agg_daily_demand` (live) / `homigo_analytics.agg_hourly_demand` (frozen) |
| Label | Daily booking count |
| Time window | 2026-06-09 → 2026-08-13 |
| Data status | **DATA_UNTRUSTED** — 50 observed days over 66 calendar days, 22 days stale |
| Training path | `src/scripts/train-models.ts` → BQML `ARIMA_PLUS` — **blocked**, billing disabled |
| Evaluation | Temporal holdout, this pass. 52-day train / 14-day test |
| Model version | `model_demand_forecast v1`, registry says trained 2026-06-20 on **44 rows** |
| Serving path | `analytics/forecast/demand-forecast.service.ts` and `vertex-ai.service.forecastDemand()` |
| Production state | Serving, with an **expired horizon** — see below |
| Shadow state | Replayed over the settled holdout; 14 predictions recorded and settled |
| Drift monitoring | Not previously present; freshness and horizon checks added this pass |
| Blocker | Pipeline dead (billing); duplicate dates in the aggregate; single `unzoned` series |

**The defect that matters.** `ML.FORECAST` projects forward from the end of *training* data, not from
now. Queried today, `model_demand_forecast` returns 168 confident hourly points covering
**2026-06-20 → 2026-06-27** — a week that ended 69 days ago — and 165 of its 168 prediction intervals
have negative lower bounds, down to −12.6 bookings. Nothing in the response said so, and two API
surfaces rendered it as the coming week.

**Every forecast model shares it:**

| Model | Forecasts up to | Expired by |
|---|---|---|
| `model_demand_forecast` | 2026-06-21T05:00Z | 75 days |
| `model_demand_forecast_daily` | 2026-08-12 | 23 days |
| `model_city_demand_forecast` | 2026-08-06T09:00Z | 28 days |
| `model_partner_earnings_forecast` | 2026-08-06T09:00Z | 28 days |

**Measured comparison** — 14-day temporal holdout, train to 2026-07-30, test 2026-07-31 → 2026-08-13,
dataset `643a5e9bc29028fe`:

| Forecaster | MAE | RMSE | Bias | MASE |
|---|---|---|---|---|
| **NAIVE** (tomorrow = today) | **1.6429** | 3.3912 | −0.9286 | 0.2479 |
| MEDIAN | 2.6429 | 3.4330 | +1.0714 | 0.3988 |
| SEASONAL_NAIVE | 2.9286 | 5.2712 | +0.7857 | 0.4419 |
| MEAN | 4.4780 | 4.6964 | +3.3791 | 0.6757 |
| ARIMA_PLUS candidate | — | — | — | — |
| `model_demand_forecast` (production) | — | — | — | — |

The ARIMA candidate could not be trained: BigQuery billing is disabled. The production model is
deliberately **not scored** — its training window overlaps the test window, so any error it showed
here would be in-sample and not comparable.

MAPE and SMAPE are not reported. Daily demand reaches 1 booking; dividing an absolute error by 1
measures the denominator, not the forecast. MASE is reported instead.

**Verdict: on this data a forecasting model is not justified over the naive baseline.**

---

### eta

| Field | Value |
|---|---|
| Purpose | Predict partner travel duration to the customer |
| Data source | `eta_training_labels` (Postgres) — actively collecting |
| Label | `actual_travel_duration_min` (dispatch → arrival) |
| Time window | 2026-08-07 → 2026-09-03 |
| Data status | **DATA_INSUFFICIENT** |
| Evidence | 65 labels · 41 VALIDATED · **2 TRAINING_READY** · 22 REJECTED · 64 with duration · **7 with travel distance** · 9 with Google ETA · 33 partners |
| Gate | 50 TRAINING_READY labels (the promotion path's own declared threshold) |
| Model version | `model_eta` registered `BLOCKED`, 0 training rows, **no artifact** |
| Serving path | `predictEta()` returns null → callers fall back to the live Google route ETA |
| Production state | Never served |

**The binding constraint is distance, not the outcome.** 64 of 65 labels carry a duration; only 7
carry `travel_distance_meters` — the single most predictive input any ETA model has. `vw_train_eta`
requires `distance_km > 0` and returns **0 rows**; `vw_train_eta_v2` also returns 0. More bookings
will not make this trainable until distance is captured at dispatch and arrival.

**Decision: `NOT_READY` / `DATA_INSUFFICIENT`.**

---

### churn

| Field | Value |
|---|---|
| Data source | `vw_customer_churn_features` |
| Data status | **DATA_INSUFFICIENT** + **leaking** |
| Evidence | 22 customers · 15 churned · 7 not churned · recency 22–87 days |
| Model version | `model_churn` `BLOCKED`, no artifact |

**Two blocking leaks, both computed rather than reviewed:**

1. **`LABEL_DEFINING_FEATURE`, 22/22 rows.** The label is `IF(recency_days >= 30, 1, 0)` and
   `recency_days` is offered as a feature. The label is reproduced exactly from that feature in every
   row, so a model scores perfectly by restating the threshold and has learned nothing about churn.
2. **`NON_REPRODUCIBLE_DEFINITION`.** `recency_days` is computed against `CURRENT_DATE()`, so the
   label changes every day the query runs. Two training runs a week apart see different labels for
   the same customers.

Neither is fixed by collecting more rows. **Decision: `HUMAN_DECISION_REQUIRED`** — the churn
definition needs a fixed observation date and a feature set that excludes the field the label is
derived from.

---

### clv

| Field | Value |
|---|---|
| Data source | `vw_customer_clv` |
| Data status | **DATA_INSUFFICIENT** + **leaking** |
| Evidence | 22 customers · 12 repeat · 15 with zero lifetime revenue · max 156 bookings for one customer · mean ₹2,610.41 |
| Model version | `model_clv v1` `PARTIALLY_TRAINED`, LINEAR_REGRESSION artifact exists |

**`TARGET_RECONSTRUCTION`, 22/22 rows.** `avg_order_value` is `lifetime_revenue / completed`, and
`lifetime_revenue` is the training label. The label is reconstructed exactly as
`avg_order_value × completed` in every row. **This is the mechanism behind the recorded R² of
0.9994** — the model recovered the target by arithmetic. That figure measures an identity, not
customer value, and must not be quoted as model quality.

**Decision: `DATA_INSUFFICIENT`.** The feature set must drop `avg_order_value` before any figure it
produces means anything, and 22 customers cannot support a value horizon regardless.

---

### provider_ranking_ltr

| Field | Value |
|---|---|
| Data source | `provider_match_scores`, `assignment_attempts` |
| Data status | **DATA_INSUFFICIENT** |
| Evidence | 1,043 score rows · 2,837 assignment attempts · 224 accepted · 388 bookings · 7.9% acceptance |
| Existing engine | Deterministic rule scorer — **stays** |

**`FUTURE_INFORMATION`, blocking.** `provider_match_scores` records what the existing rule scorer
decided, not what any outcome judged relevant. Training a ranker on it teaches the model to imitate
the rules it is meant to improve on, and the feedback loop means only providers the rules already
surfaced can ever accumulate positive labels. Acceptance is confounded by who was offered the job.

**Decision: `KEEP_EXISTING`.** No relevance label exists.

---

### personalized_recommendations

| Field | Value |
|---|---|
| Data source | `ratings`, `bookings` |
| Data status | **DATA_INSUFFICIENT** |
| Evidence | 19 ratings · 124 customers · 30 repeat customers · 37 active services |

**`FUTURE_INFORMATION`, warning.** There is no impression log. Without a record of what was shown, a
selection cannot be separated from "was the only option displayed", and any measured lift would be
the layout's rather than the model's.

**Decision: `DATA_INSUFFICIENT`.** Platform-wide popularity is not personalisation and must not be
presented as it.

---

### gps_fraud

| Field | Value |
|---|---|
| Data source | `location_history`, `partner_risk_signals` |
| Data status | **DATA_INSUFFICIENT** |
| Evidence | 501 GPS pings · 15 risk signals · 6 partners with location · 16 resolved incidents |
| Existing engine | Deterministic rules (implied speed > 120 km/h) — **stay** |

**`LABEL_DEFINING_FEATURE`, blocking.** The only available labels are the rule detector's own
firings. Training on them reproduces the rule, cannot discover anything it misses, and inherits every
false positive as ground truth.

**Decision: `KEEP_EXISTING`.**

---

### support_classification

| Field | Value |
|---|---|
| Data source | `support_tickets` |
| Data status | **DATA_INSUFFICIENT** |
| Evidence | 32 tickets · 7 categories · 8 resolved · 2026-06-10 → 2026-08-07 |
| Existing engine | LLM classification (Phase 10) — **stays** |

Supervised classification would need thousands of human-labelled examples to beat the existing LLM
classifier, and at 32 tickets the LLM's per-ticket cost is not material enough for a trained model to
pay for itself.

**Decision: `KEEP_EXISTING`.**

---

### demand_forecast_baseline — the one candidate this pass produced

| Field | Value |
|---|---|
| Purpose | Deterministic demand forecast, and the fail-safe when the warehouse cannot answer |
| Strategy | `NAIVE_LAST_OBSERVED`, floored at 0 |
| Selected by | 14-day temporal holdout against SEASONAL_NAIVE, MEAN and MEDIAN — it won |
| Metrics | MAE 1.6429 · RMSE 3.3912 · bias −0.9286 · MASE 0.2479 |
| Feature version | `demand.daily.v1` |
| Code version | `demand.baseline.v1` |
| Artifact | Rule specification, content-hashed (a rule-based model has no file, so its spec is hashed) |
| Lifecycle proven | CANDIDATE → SHADOW → APPROVED → PRODUCTION → ROLLED_BACK, 20/20 stages |
| Production state | **Not promoted in any real environment.** The lifecycle was exercised on `homigo_p39` and the probe rows were removed. |

It is not an improvement on ARIMA. It is the measured floor any future model must clear before it
earns the right to serve, and it is registered with exactly that framing.

---

## C. Final data readiness table

| Model | Readiness | Decision | Binding blocker |
|---|---|---|---|
| Demand | `DATA_UNTRUSTED` | `READINESS_ONLY` | Pipeline dead 22 days; naive baseline already wins |
| ETA | `DATA_INSUFFICIENT` | `DATA_INSUFFICIENT` | 2/50 training-ready; **7 of 65 labels carry distance** |
| Churn | `DATA_INSUFFICIENT` | `HUMAN_DECISION_REQUIRED` | Label is a function of a feature; definition moves daily |
| CLV | `DATA_INSUFFICIENT` | `DATA_INSUFFICIENT` | Target reconstructable from features in 22/22 rows |
| Provider LTR | `DATA_INSUFFICIENT` | `KEEP_EXISTING` | No relevance label; scores are the scorer's own output |
| Recommendations | `DATA_INSUFFICIENT` | `DATA_INSUFFICIENT` | 19 ratings; no impression log |
| GPS Fraud | `DATA_INSUFFICIENT` | `KEEP_EXISTING` | No adjudicated fraud outcomes |
| Support ML | `DATA_INSUFFICIENT` | `KEEP_EXISTING` | 32 tickets; LLM cost not material |

**Zero models are `DATA_READY`.** That is the finding, not a failure to deliver: the engineering that
would let a model be built, measured, governed and rolled back is complete and proven, and no model
was trained to make the roster look fuller.
