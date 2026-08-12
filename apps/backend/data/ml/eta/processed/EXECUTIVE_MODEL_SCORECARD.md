# EXECUTIVE MODEL SCORECARD — HOMIGO ETA

**Model** `eta-candidate-50k-v1-455b946bfdc7` · **Status** CANDIDATE · **Dataset** 100% synthetic

| Dimension | Result | Verdict |
| --- | --- | --- |
| Data quality | 50,000 rows, 0 nulls, 0 dup IDs, 0 ordering violations | STRONG |
| Target integrity | formula verified on 50,000/50,000 rows; vendor docs wrong | VERIFIED |
| Feature quality | 19 admitted, 12 excluded, 6 unavailable | ADEQUATE |
| Leakage | target components, post-arrival and identifier fields all excluded | CLEAN |
| Temporal validation | 3 expanding-window folds; CV MAE stdev 0.38s | STABLE |
| Best baseline | b5_google_eta_linear_recalibrated @ 115.34s CV MAE | STRONG BAR |
| Candidate (test) | MAE 98.3s · RMSE 146.18s · bias -9.1s · R² 0.9738 | see decision |
| Improvement vs best baseline | 33.36% MAE | MATERIAL |
| Tail performance | P95 309.37s · P99 517.72s | ACCEPTABLE |
| Worst segment | duration_bucket:60-70min @ 306.53s MAE | DEGRADED |
| Robustness | 0 negative, 0 NaN, 0 out-of-contract predictions | SAFE |
| Reproducibility | max delta 0.00e+00s on refit | EXACT |
| Production safety | no writes to production DB, BigQuery, model registry or config | SAFE |

## Accuracy in operational terms

Within ±1 min **48.07%** · ±2 min **72.04%** · ±5 min **94.61%** · ±10 min **99.41%**

## MODEL DECISION

# PROMISING BUT NEEDS MORE DATA

The candidate improves on the strongest baseline by 33.36% MAE. The margin is material, but the dataset is 100% synthetic: the model may be recovering the generator's rules rather than real-world travel behaviour. Production validation requires real HOMIGO telemetry.

### Required before any promotion

1. ≥50 **real** training-eligible labels (currently **0**)
2. Re-run this program on real telemetry
3. Champion-vs-Google comparison on real trips
4. Extend the BigQuery training views — they expose 10 columns and hardcode two
5. Explicit human approval

Until all five are met: **Google Maps remains the customer-facing ETA. ML inference stays OFF.**
