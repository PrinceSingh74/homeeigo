# PHASE 15 — Observability

## A. Metrics added

Six, on the **existing** Prometheus exporter. No second observability stack; no new Grafana
instance; no duplicate registry.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `homigo_simulation_runs_total` | counter | `city`, `kind` | Scenario vs what-if runs |
| `homigo_simulation_duration_seconds` | histogram | `city` | End-to-end simulation latency |
| `homigo_ai_workflow_drafts_total` | counter | `risk`, `valid` | Proposals by risk class and validity |
| `homigo_ai_workflow_draft_reviews_total` | counter | `decision`, `risk` | Human decisions |
| `homigo_cancellation_model_auc` | gauge | `model` | Measured AUC on the temporal holdout |
| `homigo_cancellation_model_materially_better` | gauge | `model` | **Materiality**, not the bare comparison |

---

## B. The one that matters most

`homigo_cancellation_model_materially_better` publishes **materiality**, deliberately.

The obvious metric to publish is `beatsBaseline`. On the current data that is `true` — while the
model's advantage over the no-model rule is 0.014 AUC against a standard error of 0.057, i.e.
**0.24 standard errors**. A dashboard reading "beats baseline = 1" would be the same misstatement
as the API returning it without an error bar, just in a medium more people look at.

So the gauge is the verdict that should drive a decision, and it currently reads **0**.

**That 0 is a measured zero**, not an absent series and not a fabricated one — the evaluation ran,
the margin was computed, and the answer was "no".

---

## C. Nothing is seeded

Phase 13 established that a fabricated zero in a histogram is a real sample in the lowest bucket
and drags every percentile toward zero. Phase 14 established that counters *are* seeded (a counter
at zero is a fact) while histograms are not (a histogram sample at zero is a claim about latency).

Phase 15 adds no seeding of any kind:

| Metric | Behaviour before first use |
|---|---|
| `homigo_simulation_runs_total` | absent until a scenario runs |
| `homigo_simulation_duration_seconds` | **absent** — a histogram is never seeded |
| `homigo_ai_workflow_drafts_total` | absent until a draft is created |
| `homigo_ai_workflow_draft_reviews_total` | absent until a human decides |
| `homigo_cancellation_model_auc` | absent until an evaluation runs |
| `homigo_cancellation_model_materially_better` | absent until an evaluation runs |

**An absent series means the thing has not happened.** None of these is initialised to zero to make
a panel look populated, and the Phase-13 test that asserts no panel renders an absent series as `0`
still governs the boards these would appear on.

---

## D. Producer-stop behaviour

Inherited and unchanged from Phase 13, which verified it platform-wide: with the exporter stopped,
**93 of 95 panels returned no series**, and the two that answered were the telemetry-health panels
— one of which read `up = 0`.

Phase-15 metrics register with that same exporter, so they disappear with it. No Phase-15 metric is
computed from a cached or stored value that would survive the producer, which is what would let a
stale number look live.

**`dataFreshness` is the Phase-15 analogue of that discipline** at the API level: the scenario
service reports `{ observedAt, basis, maxStalenessSeconds }` rather than a bare timestamp, because
the underlying twin stamps `new Date()` while serving through a 45-second cache. A bare timestamp
cannot say "up to 45s old"; this one does, and reports `UNKNOWN` when the snapshot cannot be read
at all.

---

## E. What is deliberately not instrumented

| Not measured | Why |
|---|---|
| Recommendation quality | No recommender was built — 30 customers have repeat behaviour |
| Fraud model precision/recall | No fraud model was built — 9 labels |
| Voice latency (STT/LLM/TTS) | No voice pipeline exists |
| Production prediction accuracy | Nothing serves; accuracy needs predictions paired with outcomes |
| Model drift | A model that does not serve cannot drift |

Publishing any of these as `0` would be exactly the failure Phase 13 removed from the ML board.
They are absent because the thing they would measure is absent.

---

## F. Alerting

**No new alert rules.** The 20 pre-existing rules are unchanged.

`homigo_cancellation_model_materially_better` flipping 0 → 1 is the one signal that plausibly
warrants attention, and even then it warrants **review, not automatic promotion**: the most likely
cause of a model like this suddenly improving is a new feature that encodes the outcome, not
genuine skill.

An alert needs a metric, a threshold, an owner and a runbook action. The metric now exists; the
other three remain `HUMAN_DECISION_REQUIRED`, consistent with Phase 13's `ALERT_POLICY_UNSET`
classification.

---

## G. Dashboards

**None added.** The six metrics register with the existing exporter and are queryable from the
existing Grafana. Building a Phase-15 board would mean designing panels for capabilities that are
not in production and, in three cases, were not built at all.

---

## H. Verdict

| Property | Result |
|---|---|
| Uses existing stack | **PASS** — no duplicate observability system |
| No seeded histograms | **PASS** — none seeded |
| No fabricated zeros | **PASS** — absent series stay absent |
| Measured zero distinguishable from absent | **PASS** — `materially_better = 0` is measured |
| Freshness honest | **PASS** — staleness window reported, `UNKNOWN` when unreadable |
| Metrics disappear with the producer | **PASS (inherited)** — verified platform-wide in Phase 13 |
| Nothing instrumented that does not exist | **PASS** — five deliberate absences listed |
