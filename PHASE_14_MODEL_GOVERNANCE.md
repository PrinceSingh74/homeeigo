# PHASE 14 — Model Governance

Phase 12 built the registry. This phase's job was to **verify it holds**, wrap it in Phase-14
governance, and not rebuild it. No second registry was created.

---

## A. Per-model state

Read from the governed registry (`ml_model_versions`) and `mlReadinessService`, not from the
warehouse — BigQuery billing is disabled, so the warehouse registry is physically unwritable and
cannot be the governance record.

| Model | Version | Dataset | Features | Evaluation | Shadow | Approval | Production | Rollback | Drift | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Demand forecast | warehouse ARIMA_PLUS | stale since 2026-08-19 | `MlFeatureStaging` | temporal holdout vs naive/seasonal-naive baselines | supported | — | ungoverned (warehouse) | target recorded at promotion | **horizon expired** | **BLOCKED** — external |
| ETA | candidate 98.3s MAE | `apps/backend/data/ml/eta` | GPS + Google snapshots | measured, 33% worse than Google+recalibration | supported | — | not promoted | n/a | n/a | **BLOCKED** — 0/50 real labels |
| Churn | — | leaking labels | — | R² artifact | supported | — | none | n/a | n/a | **BLOCKED** — label leakage |
| CLV | — | leaking labels | — | R²=0.9994 = leakage artifact, not accuracy | supported | — | none | n/a | n/a | **BLOCKED** — label leakage |
| Provider LTR | — | available | `provider_match_scores` | not run | supported | — | none | n/a | n/a | **NOT TRAINED** |
| Recommendations | deterministic rules v2 | n/a | n/a | rule coverage | n/a | n/a | serving as rules | n/a | n/a | **DETERMINISTIC — not an ML model** |
| GPS fraud | — | available | GPS tracks | not run | supported | — | none | n/a | n/a | **NOT TRAINED** |
| Support ML | — | ticket corpus | — | not run | supported | — | none | n/a | n/a | **NOT TRAINED** |

**No model is in governed PRODUCTION.** That is the honest state, not an omission. The four
warehouse models marked production in BigQuery have no governed approval record — reported by
`mlRegistryService.reconcile()` as `registry_reconciliation = WARN` (0.5) on the Phase-13 ML board.

---

## B. Lifecycle enforcement — verified

| Control | Mechanism | Verified |
|---|---|---|
| Legal transitions only | `ALLOWED` map in `ml-registry.service.ts` | Source; Phase-12 tests |
| No direct write to PRODUCTION | `transition()` refuses; PRODUCTION reachable only via `promote()` | Source |
| Promotion requires prior approval | `promote()` refuses anything not `APPROVED` | Source |
| Approval is a person | `approve()` requires `actorId`, a ≥10-char note **and** metrics | Source |
| Approval ≠ promotion | Two separate acts; an approval can be given and not acted on | Source |
| One production version per model | Partial unique index `ON ml_model_versions(model_name) WHERE stage='PRODUCTION'` | Database constraint |
| Rollback target is stored, not inferred | `supersededVersionId` written **at promotion time** | Schema |
| History is never erased | Rolled-back versions retained as `ROLLED_BACK` with actor, time, reason | Schema |

**§37 — `SHADOW_BETTER → PRODUCTION` cannot happen automatically.** There is no code path from a
shadow comparison to a stage change. `mlShadowService` writes observations; nothing reads them and
transitions.

---

## C. Artifact integrity

| Field | Purpose | Note |
|---|---|---|
| `datasetVersion` | Content hash of the exact training rows | Two versions with the same hash saw the same data |
| `featureVersion` | Which feature definition produced the inputs | A feature change invalidates comparability |
| `codeVersion` | Git-describable training-code id | — |
| `artifactRef` | Where the artifact lives | BigQuery model reference, or a deterministic rule id |
| `artifactHash` | Digest **where one can be computed** | **Nullable on purpose** — null for warehouse-hosted models whose bytes this platform never sees. A fabricated digest would be worse than an honest null |
| `seed` | Present only where training is genuinely seeded | Null is honest for the rest |
| `metrics` | Measured **out-of-sample** results | Never in-sample fit presented as accuracy |

**§39 — rollback cannot mix feature versions**, because `featureVersion` is pinned per version and
a rollback selects a specific stored version rather than reconstructing one.

---

## D. Phase-14 additions

| # | Change | Why |
|---|---|---|
| 1 | `ML_MODEL_APPROVED`, `ML_MODEL_PROMOTED`, `ML_MODEL_ROLLED_BACK` now retained as `SECURITY_EVENTS` (7y) | They previously fell through to `SYSTEM_LOGS` — **one year**. "Who approved the model that was serving in March" would have become unanswerable after twelve months, while the ledger entries its predictions influenced were kept for ten years |
| 2 | Governance audit events on a shared trace are no longer lost | `enterprise_audit_logs.trace_id` was UNIQUE. Demonstrated: emitting `ML_MODEL_APPROVED` then `ML_MODEL_PROMOTED` under one trace stored **only the approval**. An approval and the promotion it authorises are exactly the pair that share a request — so the most important two-event sequence in the ML lifecycle was the one guaranteed to lose its second half |
| 3 | DR drill verifies model governance survives restore | Counts alone would pass with every `approved_by` nulled |

**§2 evidence:**

```
events emitted : 2
events stored  : 1  -> ML_MODEL_APPROVED        (before)
events stored  : 2  -> ML_MODEL_APPROVED, ML_MODEL_PROMOTED   (after)
```

**§3 evidence, from the restored database:**

```
ml approval intact: p14_dr_model v1 approved_by=p14-drill
```

---

## E. Cross-phase consistency (§79)

| Lifecycle stage | Owner | Phase-14 governance |
|---|---|---|
| DATA | ETL, `EtlWatermark` | **BLOCKED** — BigQuery billing disabled |
| QUALITY | `DataQualityResult`, `mlReadinessService` | Leakage counts computed, not asserted |
| TRAIN | BigQuery ML | **BLOCKED** — external |
| EVALUATE | `demandEvaluationService`, `demandBaselineService` | Temporal holdout, MASE vs naive baselines |
| CANDIDATE | `ml-registry` | Governed transition |
| SHADOW | `ml-shadow` | Writes only `MlShadowPrediction` — cannot mutate business state |
| APPROVAL | `approve()` | Person + note + metrics; **now retained 7y** |
| PRODUCTION | `promote()` | Requires prior approval; one per model by constraint |
| DRIFT | Phase-13 health checks | Freshness + horizon measured; **PSI/KL has no agreed threshold** → `MEASUREMENT_ONLY` |
| ROLLBACK | `rollback()` | Stored predecessor; history retained; **now retained 7y** |

---

## F. Outstanding

| # | Item | Type |
|---|---|---|
| 1 | BigQuery billing | **EXTERNAL_ARTIFACT_REQUIRED** — the single root cause of every BLOCKED row in §A |
| 2 | Label leakage in CLV and churn | **ENGINEERING** — the R²=0.9994 is a leakage artifact; the features must be rebuilt before either can be a candidate |
| 3 | 50 real ETA ground-truth labels | **EXTERNAL** — the promotion path is locked and documented, blocked at 0/50 |
| 4 | Governed approval for the 4 warehouse models marked production | **HUMAN_DECISION_REQUIRED** — currently `registry_reconciliation = WARN` |
| 5 | Drift thresholds (PSI/KL) | **HUMAN_DECISION_REQUIRED** — a tolerance nobody has set |
| 6 | Production prediction accuracy | **NOT MEASURABLE** — needs predictions paired with later outcomes; only shadow carries that, and nothing serves in production |
