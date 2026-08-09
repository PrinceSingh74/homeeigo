# ETA Model Promotion Path

**Status:** Authoritative · **Owner decision:** locked 2026-08-09
**Related:** [ADR-018](./adr-018-eta-lifecycle-telemetry.md) · [Eligibility Contract](./eta-training-eligibility-contract.md) · [Model Card](../../apps/backend/data/ml/eta/processed/MODEL_CARD.md)

This is the agreed path from the offline 50K candidate to any production ETA model. It is
the reference for the next phase and supersedes informal plans.

---

## The path

```
50K Synthetic Dataset
        ↓
Offline Candidate
        ↓
98.3s MAE
        ↓
MODEL CANDIDATE ONLY
        │
        └───────────────┐
                        ↓
              Real HOMIGO Telemetry
                        ↓
              Fix/verify lifecycle capture
                        ↓
              Real eligible ETA labels
                        ↓
                    ≥50 REAL
                        ↓
              Same feature contract
                        ↓
              Same evaluation framework
                        ↓
           Google ETA + recalibration
                    VS
              HOMIGO candidate
                        ↓
             Temporal validation
                        ↓
             Segment validation
                        ↓
             Long-trip validation
                        ↓
             Severe-traffic validation
                        ↓
               Human review
                        ↓
               Promotion decision
```

---

## Fixed invariants

These do not change at any stage of the path:

| Invariant | Value |
| --- | --- |
| Customer-facing ETA | **Google Maps** until the promotion decision |
| ETA ML inference | **OFF** |
| Training threshold | **50 real eligible labels** |
| Synthetic quarantine | `is_synthetic = true` may never become training-eligible |
| Baseline to beat | **Google ETA + linear recalibration** — never raw Google |
| Target formula | `arrived_at − en_route_at` |
| Final holdout | evaluated once, after selection completes |

### Why the baseline is the recalibrated Google ETA

On the 50K sealed slice, raw Google ETA scored 454.75 s MAE at **−454.59 s bias** — it
systematically underpredicts. A two-parameter linear correction brings it to 147.52 s.
Benchmarking against the raw signal would make almost any model look good; the
recalibrated version is the honest bar. The offline candidate beat it by 33.4 %.

---

## Current position on the path

| Milestone | State |
| --- | --- |
| Offline candidate | ✅ `eta-candidate-50k-v1-455b946bfdc7`, 98.3 s MAE, CANDIDATE only |
| Lifecycle capture fixed | ✅ ADR-018 — explicit `/en-route` and `/arrived`, both clients |
| Lifecycle capture verified in production | ❌ not yet — no real partner traffic through the new actions |
| Real eligible labels | **0 / 50** |

110 completed bookings exist; 5 carry both lifecycle timestamps, and all 5 are test taps
with 0–4 s durations — below the 60 s minimum. **The path is currently blocked at
"Fix/verify lifecycle capture", not at modelling.**

---

## Recorded risks

Raised during planning, considered, and accepted by the owner. These are **notes, not
gates** — the path above proceeds as written.

### R1 — Sample size at the ≥50 milestone

The evaluation framework used for the offline candidate needed a 7,500-row sealed test to
keep 46 segments at n ≥ 100 (smallest retained segment n = 120; 8 segments dropped as
low-sample).

At 50 labels a 70/15/15 temporal split yields **35 train / 7 validation / 8 test**. On an
8-row test the confidence interval on MAE is wide enough that 98 s and 148 s are not
separable, and "severe-traffic long trips" would contain roughly 0–1 rows.

Practical reading: at 50 labels the temporal comparison against the recalibrated Google
baseline is meaningful **in aggregate only**. Segment, long-trip and severe-traffic
validation become statistically informative in the low thousands of labels.

Observed completion volume: 2026-06 → 65, 2026-07 → 34, 2026-08 → 11 (partial).
At ~35–65 completed bookings/month, 50 labels is 1–2 months; 1,000 is roughly two years.

**Mitigation while volume accumulates:** report bootstrap confidence intervals alongside
every metric, and state sample size next to every segment figure. Do not present a
segment result whose n is not shown.

### R2 — "Same feature contract" will not be literally identical

The 50K dataset and real telemetry differ in both directions:

| Feature | 50K synthetic | Real telemetry |
| --- | --- | --- |
| `bearing`, `route_efficiency` | absent — no coordinates | available from GPS |
| `partner_familiarity`, `partner_rating` | absent | available |
| `locality`, `sector`, `service_area` | present | present, different granularity |
| `provider_availability_count`, `demand_level` | present | needs confirmation |

Consequently **98.3 s is not comparable to any figure produced on real data.** Real
telemetry also introduces leak surfaces the synthetic set never had —
`booking.travelDurationMin`, `tracking.actualArrivalTime`, `quality_score`.

**Mitigation:** re-run the leakage audit and regenerate `feature-registry.json` against
real data before training on it. Treat the real-data model as a new candidate with its own
model card, not as a continuation of the 50K candidate's numbers.

---

## Reusable assets

The offline program is reproducible and its framework transfers directly to real data:

| Asset | Location |
| --- | --- |
| 20 artifacts (quality, leakage, splits, baselines, search, evaluation, cards) | `apps/backend/data/ml/eta/processed/` |
| Feature registry + prediction-time contract | `processed/feature-registry.json`, `processed/leakage-report.json` |
| Baseline ladder incl. Google recalibration | `processed/baseline-results.json` |
| Selection rule (MAE → P95 → \|bias\| → complexity) | `processed/training-config.json` |
| Exclusion telemetry | `homigo_eta_training_excluded_total` |

Environment: numpy 2.5.2, scikit-learn 1.9.0, seed `20260809`. Refit reproduces
predictions to 0.0 s deviation.

---

## Promotion decision

The final step is a **human decision**, not a metric threshold. Nothing in this path
promotes a model automatically. Until that decision is recorded, Google Maps remains the
customer-facing ETA source and ETA ML inference remains OFF.
