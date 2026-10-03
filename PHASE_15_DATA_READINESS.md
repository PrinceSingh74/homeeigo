# PHASE 15 — Data Readiness

Run **before** any model was written. The purpose was to decide which of the three ML capabilities
Phase 15 asked for could be honestly built, and the answer was one of three.

All counts are live reads of `homigo_db` (read-only). Date of measurement: 2026-09-05.

---

## A. Method

For each proposed model the same four questions were asked, in order, and a "no" at any point
stopped the work rather than being noted and worked around:

1. **Does a label exist?** Not a proxy, not a rule's output — an outcome the platform actually
   observed.
2. **Are there enough positives?** A balanced-sounding rate over a tiny denominator is not data.
3. **Is there a signal to learn from?** For personalisation this means repeat behaviour; for
   anomaly detection it means variation the rules do not already capture.
4. **Can features be computed without leakage?** Specifically without target reconstruction and
   without a customer's future informing their past.

---

## B. Recommendation — `BLOCKED_BY_DATA`

| Measure | Value | Bearing on the decision |
|---|---|---|
| Bookings | 522 | Interaction count |
| Distinct customers who booked | 147 | Users dimension |
| **Customers with ≥2 bookings** | **30** | The signal a recommender learns from |
| Customers with ≥5 bookings | 10 | Enough history to personalise |
| Explicit ratings | **22** | Explicit-feedback signal |
| Services booked / in catalogue | 37 / 55 | Item dimension, coverage |
| History span | 87 days | Temporal depth |

**The blocking fact: 117 of 147 customers (80%) have booked exactly once.**

Collaborative filtering and learning-to-rank both learn from repeated preference. Here cold-start
is not the edge case to handle — it is four fifths of the population. A model trained on this would
be a popularity ranker with a personalisation label on it, and the 22 ratings give no explicit
signal to correct that with.

**Not built.** §8: *"If data is insufficient: do not fake a model. Build the infrastructure and
classify the capability as DATA_INSUFFICIENT."*

**To unblock:** repeat-booking depth. This is a marketplace-maturity question, not an engineering
one — no amount of feature work substitutes for customers coming back.

---

## B2. The second global data audit — and what the first one missed

§35 requires a whole-project search before accepting a data blocker. The first audit looked at
customer→service repeat bookings, found 80% of customers had booked once, and stopped. That was
right about that dataset and **wrong as a verdict on the platform**: it never asked whether a
ranking problem with real labels existed anywhere else.

One does.

| Candidate source | Rows | Usable? |
|---|---|---|
| `assignment_attempts` | **3,164** | **YES** — real observed outcomes |
| `provider_match_scores` | 2,386 | **No** — `booking_id` is entirely NULL |
| `ai_messages` | 4,284 | No — conversation text, no preference label |
| `notifications` | 6,990 | No — delivery records, no engagement outcome |
| `ratings` | 22 | No |
| `coverage_requests`, `marketing_touches`, `cx_survey_responses`, `coupon_usages` | **0** each | No |

### `assignment_attempts` — a real label

```
ACCEPTED   236     the provider took the job
TIMEOUT   2904     the offer expired unanswered
REJECTED     7     the provider declined
SENT        17     still in flight — excluded, no label yet
54 providers · 417 jobs · 88-day span · 7.5% positive rate
```

This is an outcome the platform *observed*, not a rule's own output. Ordering offers by predicted
acceptance is a recommendation problem, and it is the one this data supports.

### `provider_match_scores` — the trap

2,386 rows of the assignment engine's own scoring, and the obvious training set. **Its `booking_id`
is NULL on every row**, so no score can be joined to whether that provider was actually chosen.
Scores without outcomes are the scorer's opinion; training on them teaches a model to imitate the
thing it was meant to improve — the same trap `fraud_signals` represents.

**A methodological note:** `pg_stat_user_tables.n_live_tup` reported 7 bookings and 30 ledger
entries. The real counts are 529 and 2,003 — the statistics were stale. Every count in this
document is a real `count(*)`.

---

## C. Fraud — `BLOCKED_BY_DATA`

| Label source | Count | Nature |
|---|---|---|
| `fraud_alerts` | **0** | — |
| `fraud_risk_scores` | 1 | Scored, not adjudicated |
| `financial_fraud_cases` | 1 | Confirmed case |
| `fraud_decision_logs` | 6 | Investigator decisions |
| **`chargebacks`** | **9** | The only external ground truth |
| `fraud_signals` | 100 | **Rule output — not labels** |

**Nine confirmed-fraud-adjacent outcomes in the platform's history.**

The 100 fraud signals look like data and are not: they are the existing deterministic rule engine's
own output. Training on them teaches a model to reproduce the rules it was supposed to improve
upon, and its apparent accuracy would measure agreement with the rules rather than agreement with
reality — a feedback loop dressed as a metric (§9, "investigator feedback contamination").

**Not built.** The deterministic fraud services remain the control and §9's default posture is
unchanged: DETECT → SCORE → EXPLAIN → REVIEW → HUMAN DECISION.

**To unblock:** adjudicated outcomes. Chargebacks accumulate slowly and are themselves a biased
sample (only fraud the customer noticed and disputed).

---

## D. Cancellation risk — `SUFFICIENT, with stated limits`

The only target that survived the audit.

| Measure | Value |
|---|---|
| Terminal bookings (labelled) | **387** |
| Cancelled (positive class) | **161** (41.6%) |
| — by user | 102 |
| — by provider | 59 |
| Completed (negative class) | 226 |
| With `scheduled_date` and `base_amount` | 387 / 387 |
| Span | 2026-06-09 → 2026-09-04 |

A real observed outcome, naturally balanced, complete on the features it needs. Small — and the
evaluation was built to say so rather than to hide it.

### Feature set, and what was refused

Every feature is knowable at the instant the booking row is created. **Thirteen fields were
excluded**, four of them because they reconstruct the target:

| Excluded | Class |
|---|---|
| `cancelled_at`, `completed_at` | **TARGET_RECONSTRUCTION** — non-null iff the label has a particular value |
| `cancellation_reason`, `cancelled_by`, `refund_status` | **LABEL_DEFINING** — the label wearing a disguise |
| `accepted_at`, `started_at`, `actual_duration` | **OUTCOME** |
| `provider_id`, `assigned_at`, `queue_position`, `premium_matched` | **POST_CREATION** |
| `payment_status` | **EVOLVES** — its value at prediction time differs from its value at read time |

Used: lead time, scheduled hour (as sin/cos), weekend, base amount, discount present, prior
booking count, prior cancellation rate, first-booking flag.

**Temporal leakage guard.** Customer history is accumulated in a single pass over bookings ordered
by `created_at`, and the counters advance **after** each example is emitted. Computing the same
features with an aggregate query would let a customer's later cancellations inform their earlier
prediction — the most common way a model like this looks excellent offline and is useless in
production.

### Result

```
split          : TEMPORAL  train=270 test=117 testPositives=32
candidate      : AUC 0.7085  Brier 0.2158
prior-rate rule: AUC 0.6945  Brier 0.2216
base-rate      : AUC 0.5000  Brier 0.2404
materiality    : margin 0.014 vs SE 0.057 = 0.24 SE -> NOT materially better
```

The data was sufficient to build and evaluate. It was **not sufficient to demonstrate value**, and
that is the finding.

---

## D2. Provider acceptance — `SUFFICIENT, and the result is a negative`

Built from `assignment_attempts` after the second audit found it.

**Features, all knowable at dispatch time:** provider's prior offer count, prior acceptance rate,
first-offer flag, prior median response time, dispatch hour (sin/cos), weekend, and how far down the
dispatch chain this offer sits.

**Excluded:** `status` (the label), `responded_at` and `response_ms` (a response exists only for
offers that got one), `assignment_jobs.accepted_at` and `.status` (the outcome), and all of
`provider_match_scores` (no outcome join).

**Temporal leakage guard:** per-provider counters advance *after* each example is emitted, so an
offer never sees the provider's own later behaviour.

### Result

```
split          : TEMPORAL  train=2202 test=945 testPositives=84
windows        : train 2026-06-09 -> 2026-08-13   test 2026-08-13 -> 2026-09-05
balance        : overall 7.5%  train 6.9%  test 8.9%

candidate      : AUC 0.9528  Brier 0.0527
prior-rate rule: AUC 0.9642  Brier 0.0425     <-- the baseline WINS
base-rate      : AUC 0.5000  Brier 0.0814

beatsBaseline  : false
materiality    : margin -0.0114, SE 0.0163 (-0.7 SE) -> NOT materially better
```

**An AUC of 0.95 that should not be shipped.** In isolation it reads as a triumph. Against the
baseline it is a regression: predicting each provider's own historical acceptance rate ranks
*better* than the model.

**Why, and it is not subtle:** only **16 of 54 providers have ever accepted anything**, and one
provider accounts for **176 of the 236 acceptances** at a 53% rate. Acceptance is almost entirely
determined by provider identity, which the per-provider rate captures directly; the model's extra
features (hour, weekend, chain position) add variance without adding signal.

The strongest learned coefficient is `job_attempt_index_log = −1.13` — offers later in a dispatch
chain are markedly less likely to be accepted, which is real and sensible, and still not enough to
beat identity.

**Actionable finding:** the assignment engine should rank on observed per-provider acceptance rate.
A learned model is not warranted on this data, and this evaluation is the evidence for that rather
than an opinion about it.

---

## E. ETA — `BLOCKED_BY_DATA` (inherited from Phase 12)

75 rows in `eta_training_labels`, all quarantined during Phase 12: the source spreadsheet's own
sheets disagreed about its size and a duration bound was wrong by a factor of 2.2. The promotion
path is documented and blocked at 0 of 50 required real labels. **Unchanged by this phase.**

---

## F. Simulation inputs — `SUFFICIENT for a deterministic model, INSUFFICIENT to validate one`

The scenario engine reads live aggregates (7 geofenced zones, 296 providers, live demand and
supply), so its **baseline** is real.

Its **coefficients** are not measured. Rain ×1.25, festival ×1.6, elasticity `exp(-0.6Δ)`, ETA
penalty ×0.3 — five priors, none derived from this platform's data:

- No weather-joined booking history exists to fit the rain multiplier.
- No festival calendar or festival-labelled bookings exist at all.
- The elasticity has no price experiment to fit from: the one pricing experiment on the platform
  has **identical arms** and records **no conversions** (Phase-14 finding G4).

So the simulation is directionally reasonable and **unvalidatable with current data**. That is why
the service returns `confidence: { kind: "UNVALIDATED" }` rather than the engine's hardcoded 0.8,
and names each prior in the response.

**To unblock validation:** backtesting — storing scenario results and comparing them against what
subsequently happened. The infrastructure for that (reproducible `scenarioId`, `snapshotId`,
`modelVersion`) is now in place; the comparison is not built, because there is nothing yet stored
to compare.

---

## G. Summary

| Capability | Labels available | Positives | Verdict |
|---|---|---|---|
| Recommendation — customer→service | interaction history | 30 customers with repeat behaviour | **BLOCKED_BY_DATA** |
| **Recommendation — provider ranking** | **`assignment_attempts.status`** | **236 acceptances** | **SUFFICIENT — built and evaluated** |
| Fraud | chargebacks + cases | **9** | **BLOCKED_BY_DATA** |
| Cancellation risk | booking terminal status | **161** | **SUFFICIENT to build, insufficient to prove value** |
| Provider acceptance | `assignment_attempts.status` | **236** | **SUFFICIENT — built; baseline wins** |
| ETA | quarantined | 0 of 50 | **BLOCKED_BY_DATA** (Phase 12) |
| Simulation | live aggregates | n/a — deterministic | **Baseline real, coefficients unvalidated** |

**One model of five was buildable. It was built, evaluated honestly, and the evaluation says not to
promote it.** That is the correct outcome of a data-readiness discipline, not a shortfall against
it.
