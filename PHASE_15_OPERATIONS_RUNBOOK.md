# PHASE 15 — Operations Runbook

**Owner:** `OWNER_UNASSIGNED`. This platform has no ownership register and naming someone would put
them on the hook for something they never accepted.

**Scope:** the three capabilities Phase 15 built. Voice, recommendation and fraud ML are not here
because they were not built — see `PHASE_15_CAPABILITY_MATRIX.md`.

---

## 1. Where things are

| Capability | Endpoint | Auth |
|---|---|---|
| Scenario simulation | `POST /api/digital-twin/:city/scenario` | `requireRole("ADMIN")` |
| Executive what-if | `POST /api/digital-twin/:city/what-if` | `requireRole("ADMIN")` |
| List workflow drafts | `GET /api/admin/governance/workflow-drafts` | `ANALYTICS/READ` |
| Create workflow draft | `POST /api/admin/governance/workflow-drafts` | `SETTINGS/UPDATE` |
| Review workflow draft | `POST /api/admin/governance/workflow-drafts/:id/review` | `SETTINGS/APPROVE` |
| Cancellation evaluation | `GET /api/admin/governance/models/cancellation-risk/evaluation` | `ANALYTICS/READ` |

**None of this is deployed to production.** See §7.

---

## 2. Reading a scenario result

The numbers are the least important part of the response. Read these first:

| Field | What it tells you |
|---|---|
| `confidence.kind` | Always `UNVALIDATED`. The model has never been compared against an outcome |
| `assumptions[]` | Six coefficients. **Five are `UNVALIDATED_PRIOR`** — rain, festival, elasticity, ETA penalty, rain-traffic |
| `dataFreshness.observedAt` | When the baseline was actually observed |
| `dataFreshness.maxStalenessSeconds` | **45.** The twin is cached; the baseline may be that much older |
| `limitations[]` | Five, including `NOT_BACKTESTED` |
| `scenarioId` / `snapshotId` | Two results are comparable **only if `snapshotId` matches** |

**Do not compare two scenarios with different `snapshotId`s.** They started from different
baselines. The ids differ precisely so that this is visible.

**Do not convert `delta.revenuePct` into money.** The service refuses to for a reason:
`financialProjection.available` is `false`, and the reason field says why.

---

## 3. Reviewing a workflow draft

**What approval means:** you have authorised a developer to implement it. **Nothing runs.**
`nextStep` says so on every approved response.

Before approving, read:

| Field | Check |
|---|---|
| `riskClass` | `INERT` (no messages) · `NOTIFYING` (real people get messages) · `ESCALATING` (human queue) · `REJECTED_UNSAFE` (cannot be approved) |
| `validation.findings` | Every check, including the ones that passed |
| `validation.allowlistSnapshot` | How many conditions/triggers/templates existed at validation time |
| `intent` | What was actually asked for |
| `promptHash` | Ties the draft to that request |

**A `REJECTED_UNSAFE` draft cannot be approved.** The service re-validates at approval and returns
`REVALIDATION_FAILED`.

**Re-validation can fail on a previously valid draft.** That is intended: if a condition it names
was removed since it was drafted, approving it would authorise a workflow that stops at that step
every time.

---

## 4. Reading the cancellation evaluation

```
beatsBaseline    : true
materiallyBetter : FALSE     <-- this is the one that matters
```

**`beatsBaseline` alone is not a reason to promote anything.** On the current data the candidate
beats the baseline rule by 0.014 AUC against a standard error of 0.057 — a quarter of one standard
error, i.e. indistinguishable.

| Field | Read as |
|---|---|
| `materiality.materiallyBetter` | The promotion signal. `false` means "no measurable improvement" |
| `materiality.marginInStandardErrors` | Below ~2, the margin is noise |
| `split.kind` | Must be `TEMPORAL`. If it ever says otherwise, the metrics are invalid |
| `split.testPositives` | Below 15 the service refuses to evaluate at all |
| `limitations` | Includes `NOT_SERVING` — nothing consumes this score |

The Prometheus gauge is `homigo_cancellation_model_materially_better`, **not** the bare comparison.

---

## 5. Metrics

| Metric | Normal | Investigate when |
|---|---|---|
| `homigo_simulation_runs_total{city,kind}` | rises with admin use | sustained high rate — each run reads the twin |
| `homigo_simulation_duration_seconds{city}` | sub-second on a cache hit | p95 climbing → twin cache misses |
| `homigo_ai_workflow_drafts_total{risk,valid}` | mixed | `valid="false"` dominating → whatever generates drafts is producing unusable output |
| `homigo_ai_workflow_draft_reviews_total{decision,risk}` | approvals and rejections | approvals of `ESCALATING` without discussion |
| `homigo_cancellation_model_auc{model}` | ~0.71 | a large jump — suspect leakage, not improvement |
| `homigo_cancellation_model_materially_better{model}` | **0** | a change to 1 warrants review, not automatic promotion |

**A sudden AUC jump is a leakage alarm, not good news.** The single most likely cause of a model
like this improving dramatically is a new feature that encodes the outcome.

---

## 6. Troubleshooting

**Every draft is `REJECTED_UNSAFE` with `CONDITION_UNKNOWN` / `TRIGGER_UNKNOWN`.**
The registries are empty in this process. `registerAllConditions()` runs at boot; in a script or a
test that has not booted, the allowlists are empty and everything is refused. Correct behaviour —
failing closed — but check the process before blaming the generator.

**`NOTIFICATION_REGISTRY_EMPTY` warnings.**
No `ACTIVE` notification templates in this environment, so the type could not be checked. A warning,
not an error: the draft is not refused, but the notification type is unverified.

**A scenario returns `dataFreshness.basis: "UNKNOWN"`.**
The twin snapshot could not be read. The scenario still computed, but the age of its baseline is
unknown — and it says so rather than reporting itself as fresh.

**The evaluation returns `DATA_INSUFFICIENT`.**
Either fewer than 130 usable examples or fewer than 15 holdout positives. Both are deliberate
refusals; metrics below those thresholds are noise.

**Two reviewers both clicked approve.**
One gets `LOST_RACE`. The draft is in exactly one terminal state. Re-read it before retrying.

---

## 7. Environment status

| | State |
|---|---|
| Development | Operational |
| Test | Migration applied, suite green |
| Staging | Not deployed |
| **Production** | **Not deployed — blocked.** 10 migrations outstanding, including the Phase-12 model registry and all of Phase 14 |

**Do not describe any Phase-15 capability as live.** It is operational in development. Those are
different words for different things.

---

## 8. Known limitations

- **The simulation has never been backtested.** No scenario result has been compared against what
  subsequently happened. The infrastructure to do so now exists (`scenarioId`, `snapshotId`,
  `modelVersion`); the comparison does not, because nothing is stored yet.
- **Five of six simulation coefficients are unvalidated priors.** They may be reasonable. They are
  not measurements.
- **The cancellation model does not serve anything** and should not be promoted on current
  evidence.
- **The vision-injection finding is time-limited.** Vision output reaches no LLM prompt *today*.
  If a consumer is added, that must be re-audited — the bypass guard covers provider calls, not
  content flow.
- **Draft generation is ungoverned if it bypasses the gateway.** No such caller exists; if one is
  added it needs its own budget and rate-limit coverage.
