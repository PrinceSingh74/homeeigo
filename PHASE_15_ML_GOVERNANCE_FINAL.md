# PHASE 15 — ML Governance

## A. Models proposed vs models built

Phase 15 asked for three ML capabilities. A data-readiness audit ran first, and **one of three**
survived it.

| Proposed | Built | Reason |
|---|---|---|
| Advanced recommendation ML | **No** | 117 of 147 customers have booked exactly once; 22 ratings total |
| Sophisticated fraud ML | **No** | 9 confirmed labels in the platform's history |
| Advanced predictive operations | **Yes** — cancellation risk | 387 terminal bookings, 161 cancelled (41.6%) |

Not building two of them is the governed outcome, not a shortfall. §5 forbids inventing training
data, labels and accuracy; §8 and §9 require a readiness audit before a model exists.

---

## B. The one model, fully specified

| Field | Value |
|---|---|
| Model name | `cancellation-risk` |
| Version | `cancellation-risk.v1` |
| Algorithm | Logistic regression, batch gradient descent, L2 = 0.01, bias unregularised |
| Training data | `bookings` with terminal status |
| Training window | 2026-06-09 → 2026-08-24 (270 examples) |
| Evaluation window | 2026-08-24 → 2026-09-04 (117 examples, 32 positives) |
| Split | **TEMPORAL** — never random |
| Feature version | 9 features + bias, named in `FEATURE_NAMES` |
| Baselines | base-rate (calibration bar) **and** prior-cancellation-rate rule (ranking bar) |
| Serving status | **NOT SERVING** — no consumer, no registry entry, no shadow |
| Registry entry | **None**, deliberately — see §E |

### Measured metrics

| | AUC | Brier |
|---|---|---|
| **Candidate** | **0.7085** | **0.2158** |
| Prior-cancel-rate rule | 0.6945 | 0.2216 |
| Base rate | 0.5000 | 0.2404 |

### Materiality — the number that governs the decision

```
beatsBaseline    : true    (auc: true, brier: true)
aucMargin        : 0.0140
aucStandardError : 0.0570   (Hanley–McNeil, 32 positives / 85 negatives)
marginInSE       : 0.24
materiallyBetter : FALSE
```

**The candidate beats both baselines and must not be promoted.** A 0.014 advantage against a 0.057
standard error is a quarter of one SE — indistinguishable from the baseline rule. The dominant
coefficient is `prior_cancel_rate` at 2.37, meaning the model largely re-derives that rule with a
little extra from lead time and weekend.

`beatsBaseline` and `materiallyBetter` are returned as separate fields specifically so they cannot
be collapsed, and the Prometheus gauge publishes **`homigo_cancellation_model_materially_better`**
rather than the bare comparison — a dashboard reading "beats baseline = 1" for a margin inside the
noise would be the same misstatement in a different medium.

*(This check did not exist in the first implementation. The first run reported `beatsBaseline:
true` with no error bar, which was arithmetically correct and would have been misleading in
exactly the way this phase forbids.)*

---

## C. Leakage controls

### Excluded features — 13, with reasons

| Field | Class |
|---|---|
| `cancelled_at`, `completed_at` | **TARGET_RECONSTRUCTION** — non-null iff the label has a given value |
| `cancellation_reason`, `cancelled_by`, `refund_status` | **LABEL_DEFINING** — the label in disguise |
| `accepted_at`, `started_at`, `actual_duration` | **OUTCOME** |
| `provider_id`, `assigned_at`, `queue_position`, `premium_matched` | **POST_CREATION** |
| `payment_status` | **EVOLVES** |

A test asserts each of these is absent from `FEATURE_NAMES` and that every exclusion carries a real
reason, so the list cannot decay into an unexplained denylist.

### Temporal leakage

Customer history (`prior_bookings`, `prior_cancel_rate`, `is_first_booking`) is accumulated in a
single pass ordered by `created_at`, with the counters advancing **after** each example is emitted.

An aggregate query would have been simpler and wrong: it would let a customer's later cancellations
inform their earlier prediction — the single most common way a model like this scores well offline
and fails in production.

### Split discipline

Temporal, asserted by test: `testStart >= trainStart` and `testEnd >= trainEnd`. A random split
lets the model see bookings made *after* those it is graded on, which for week-to-week drifting
behaviour is grading your own homework.

---

## D. Guardrails that refuse to evaluate

The service returns `DATA_INSUFFICIENT` rather than a weak number when:

| Condition | Threshold |
|---|---|
| Too few usable examples | < 130 |
| Too few holdout positives | < 15 |

Verified: `evaluate(0.01)` — a 1% holdout — returns `DATA_INSUFFICIENT` naming the holdout, rather
than metrics computed on a handful of positives.

---

## E. Why nothing was registered in the ML registry

Two independent reasons, either sufficient:

1. **The model does not deserve promotion.** Its advantage is inside its own error bar. Registering
   a CANDIDATE would be defensible; registering anything further would not, and registering a
   candidate nobody will promote adds a row without adding governance.
2. **`ml_model_versions` does not exist in production.** The Phase-12 migration
   (`20260906090000_ml_model_governance`) is one of ten unapplied. There is no governed registry in
   production to register into.

Phase-12 governance is otherwise **unchanged**: the `ALLOWED` transition map, approval-before-
promotion, the person-with-a-note requirement, and the partial unique index enforcing one
PRODUCTION version per model all stand.

---

## F. Drift and monitoring

| Signal | State |
|---|---|
| `homigo_cancellation_model_auc` | published when evaluated |
| `homigo_cancellation_model_materially_better` | published when evaluated |
| Production drift | **Not applicable** — nothing serves |
| Retraining schedule | **None** — a model that is not serving does not need one |
| Data-freshness monitoring | Inherited from Phase 13's ML platform health checks |

---

## G. Stated limitations

Returned in the evaluation response itself, not only in this document:

- **SMALL_SAMPLE** — 387 terminal bookings over 87 days. Error bars are wide and this evaluation
  computes them only for AUC.
- **NO_SEGMENT_ANALYSIS** — no breakdown by service, city or tenure, so a model working for one
  segment would look uniformly adequate.
- **SINGLE_SPLIT** — one temporal cut, not walk-forward validation. A different cut could give a
  materially different answer.
- **NOT_SERVING** — offline evaluation only.

---

## H. Cross-phase consistency

| Phase | Interaction |
|---|---|
| 12 — model registry | Unchanged. No new registry, no new lifecycle |
| 12 — ETA model | Unchanged; still blocked at 0/50 real labels |
| 13 — ML platform health | Unchanged; the four health checks still report the warehouse's real state |
| 14 — governed audit | Reused for draft approvals (`recordGoverned`, fail-closed) |

**No duplicate ML engine, registry, feature store or evaluation framework was created.**
