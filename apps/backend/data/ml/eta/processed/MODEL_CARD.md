# MODEL CARD — eta-candidate-50k-v1-455b946bfdc7

> **THIS MODEL IS AN OFFLINE CANDIDATE.** It is not production validated, not deployed,
> and not promoted. Google Maps remains the customer-facing ETA source and ETA ML
> inference remains OFF.

## 1. Purpose

Offline candidate for predicting partner travel time (dispatch → arrival) on the HOMIGO
platform. Built to establish whether a learned model can beat the existing Google-ETA
baseline, and to exercise the Phase-2 ETA feature and validation contracts end to end.

## 2. Dataset

| | |
| --- | --- |
| Source | `apps/backend/data/ml/eta/raw/ETA_Training_Data.csv` |
| SHA256 | `455b946bfdc77e06ba25b5cff9f28f2f7811c3ec85a6975c066e3f6ccafadae4` |
| Version | `eta-50k-fs-v1` |
| Rows / Columns | 50,000 / 31 |
| Nulls / Duplicate IDs / Duplicate rows | 0 / 0 / 0 |
| Coverage | 2024-01-01 → 2024-06-28 (NCR: Delhi, Gurugram, Noida) |
| **Synthetic** | **Yes — 100%. `is_synthetic=True`, `is_training_eligible=False` on every row.** |

Train 35,000 · Validation 7,500 · Test 7,500 — split **temporally** by `dispatched_at`.

## 3. Target

`actual_travel_duration_sec` = **`arrived_at - en_route_at`**

Verified independently, not taken from documentation: the formula matches
**50,000/50,000** rows. The vendor documentation claims
`arrived_at - dispatched_at`, which matches only **169** rows — using it
would fold a mean 17.42s of dispatch wait into the label.

Range 60.0–9889.9s · median 1010.2s · P95 2739.7s.
All rows fall inside the contract window [60, 14400]s. **No clamping was applied.**

## 4. Prediction-time contract

> Prediction is made at dispatch/en-route time, before travel begins. A feature is admissible only if its value is knowable at that instant.

## 5. Features (19)

Numeric — distance_km, google_eta_sec, hour, day_of_week, is_weekend, temperature_c, rain_mm, visibility_km, provider_availability_count, surge_multiplier, estimated_wait_before_dispatch_sec

Categorical — city, locality, sector, service_area, service_category, traffic_level, weather_condition, demand_level

### Excluded (12)

| Feature | Reason |
| --- | --- |
| `actual_travel_duration_sec` | THE TARGET |
| `arrived_at` | target component — arrival time |
| `en_route_at` | target component; used only to build the label and the temporal split |
| `arrival_source` | how arrival was detected — post-arrival |
| `quality_score` | assessed after trip completion |
| `validation_status` | assigned after validation |
| `validation_flags` | assigned after validation |
| `trip_id` | identifier — memorisation risk |
| `dispatched_at` | raw timestamp; used for the temporal split, not as a feature |
| `google_eta_captured_at` | raw timestamp, redundant with dispatched_at |
| `is_synthetic` | dataset flag — filter, never a feature |
| `is_training_eligible` | eligibility flag — filter, never a feature |

### Unavailable in this dataset

- `bearing` — requires partner/pickup coordinates — absent from this dataset
- `route_efficiency` — requires straight-line vs travelled distance — coordinates absent
- `average_speed` — derivable but leaks the target (distance / duration)
- `partner_familiarity` — requires partner history — absent
- `historical_avg_delay` — requires partner history — absent
- `partner_rating` — absent from this dataset

### Leakage controls

- target and its components never enter the feature matrix
- post-arrival quality/validation fields excluded
- identifier excluded to prevent memorisation
- temporal split so no future row informs a past fold
- no target-derived aggregate (e.g. average speed) constructed

## 6. Architecture & hyperparameters

`HistGradientBoostingRegressor(loss=absolute_error)` — boosted regression trees — same family as production BOOSTED_TREE_REGRESSOR.

```json
{
  "learning_rate": 0.1,
  "max_depth": 6,
  "min_samples_leaf": 50,
  "l2_regularization": 0.0,
  "max_iter": 400,
  "max_features": 1.0
}
```

Seed `20260809`. Selection rule: within 1% of best CV MAE, then lowest P95 AE, then lowest |bias|, then fewest trees.

## 7. Baselines (sealed test slice)

| Model | MAE | RMSE | Bias |
| --- | ---: | ---: | ---: |
| Global median | 689.4s | 995.11s | -418.91s |
| **Google ETA (raw)** | **454.75s** | 600.41s | **-454.59s** |
| Google ETA (linear recalibration) | 147.52s | 209.68s | -64.66s |
| **Candidate** | **98.3s** | **146.18s** | **-9.1s** |

Raw Google ETA underpredicts by 454.59s on average — consistent with the dataset's
documented ~99% underprediction rate. A two-parameter recalibration removes most of it,
which is why it, not the raw signal, is the bar the candidate must clear.

## 8. Test performance (single evaluation, after selection)

| Metric | Value |
| --- | ---: |
| MAE | 98.3s (1.64 min) |
| RMSE | 146.18s (2.44 min) |
| Median AE | 64.15s |
| P90 / P95 / P99 AE | 229.25s / 309.37s / 517.72s |
| Bias | -9.1s |
| R² | 0.9738 |
| Within ±1 / ±2 / ±5 / ±10 min | 48.07% / 72.04% / 94.61% / 99.41% |

## 9. Segment performance

Worst segments (≥100 samples):

| Segment | n | MAE | P95 AE | Bias |
| --- | ---: | ---: | ---: | ---: |
| duration_bucket:60-70min | 120 | 306.53s | 613.89s | -187.43s |
| duration_bucket:50-60min | 268 | 232.08s | 514.97s | -75.8s |
| distance_km_bucket:7 | 238 | 195.19s | 568.88s | -8.96s |
| duration_bucket:40-50min | 453 | 174.02s | 413.59s | -29.14s |
| traffic_level:SEVERE | 2052 | 160.65s | 453.33s | -20.36s |

Best segments:

| Segment | n | MAE | Bias |
| --- | ---: | ---: | ---: |
| distance_km_bucket:0 | 244 | 16.8s | 1.04s |
| traffic_level:LOW | 316 | 31.35s | -2.93s |
| duration_bucket:0-10min | 1245 | 31.74s | 7.73s |
| distance_km_bucket:1 | 510 | 40.18s | -1.77s |
| traffic_level:MODERATE | 795 | 45.48s | 3.05s |

8 low-sample segments (<100 rows) were excluded from ranking, not hidden:
distance_km_bucket:8, distance_km_bucket:9, duration_bucket:100-110min, duration_bucket:110-120min, duration_bucket:120-130min, duration_bucket:70-80min, duration_bucket:80-90min, duration_bucket:90-100min

## 10. Calibration

Mean residual -9.1s · median -4.46s.
A linear recalibration of the candidate was evaluated as a separate option
(test MAE 98.19s) and **was not adopted** — predictions are
never silently altered.

## 11. Robustness

- Negative predictions: **0** · NaN: **0** · above contract max: **0**
- Prediction range 52.5–6041.0s against actual 60.0–7363.6s
- Long trips (P95+): MAE 291.38s · Short trips (P5−): MAE 16.31s

Stress tests:

| Perturbation | MAE | Mean shift |
| --- | ---: | ---: |
| google_eta_missing_as_median | 443.9s | -216.53s |
| traffic_forced_to_SEVERE | 325.7s | 284.84s |
| rain_forced_to_p99 | 98.35s | -0.68s |

## 12. Feature importance

Permutation importance on the sealed slice (MAE increase when shuffled):

1. `google_eta_sec` +512.726s
2. `traffic_level` +168.822s
3. `distance_km` +134.602s
4. `weather_condition` +25.167s
5. `visibility_km` +3.739s
6. `hour` +0.078s
7. `service_category` +0.058s
8. `temperature_c` +0.04s
9. `estimated_wait_before_dispatch_sec` +0.038s
10. `day_of_week` +0.016s

## 13. Outliers

no rows deleted; the contract window [60,14400]s already bounds the target and every row falls inside it, so long trips are treated as valid extremes rather than corruption

Underprediction 52.32% · overprediction 47.68%.

## 14. Reproducibility

Refitting with identical dataset, features, config and seed reproduces predictions to
**0.00e+00s** max deviation. Requires numpy 2.5.2 / scikit-learn 1.9.0.

## 15. Known limitations

1. **The dataset is 100% synthetic.** Every metric here describes performance on generated
   data. The model may be recovering the generator's rules rather than real travel behaviour.
2. **No coordinates**, so `bearing`, `route_efficiency`, `partner_familiarity` and
   partner-history features — which the production feature engineer computes — cannot be used.
3. **Six months of one region** (NCR, Jan–Jun 2024), over two years stale.
4. **The production training view exposes 10 columns**, of which two are hardcoded constants.
   Consuming this feature set in production would require extending the warehouse views.
5. **Trained with scikit-learn, not BigQuery ML.** Same model family, different implementation —
   BigQuery was unreachable (no GCP credentials). Numbers will not transfer exactly.

## 16. Production readiness

**NOT PRODUCTION READY.** Status `CANDIDATE`. Promotion requires: ≥50 real training-eligible
labels, offline evaluation on real telemetry, a champion-vs-Google comparison on real
trips, and explicit human approval. Google Maps remains the customer-facing ETA source.

**Decision: PROMISING BUT NEEDS MORE DATA** — The candidate improves on the strongest baseline by 33.36% MAE. The margin is material, but the dataset is 100% synthetic: the model may be recovering the generator's rules rather than real-world travel behaviour. Production validation requires real HOMIGO telemetry.
