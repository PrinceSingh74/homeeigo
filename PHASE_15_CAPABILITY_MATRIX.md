# PHASE 15 — Capability Matrix

Eight capabilities. Each was audited for **data and policy readiness before any code was written**,
because the alternative — building all eight and discovering afterwards which ones were real — is
how a platform ends up with confident interfaces over nothing.

**Environment:** development. `homigo_p39` / `homigo_test` for writes, `homigo_db` read-only.
**Nothing in this phase is production LIVE**, and the reason is not this phase's work — see §0.

---

## 0. Production maturity gate — **FAILED, and not by a small margin**

Phase 15 cannot be production-operational because the foundation it builds on is not in production.
Measured directly against `homigo_db`, not inferred from any prior report:

| Prerequisite | Production state |
|---|---|
| Audit `trace_id` uniqueness removed | **NO** — `enterprise_audit_logs_trace_id_key` still UNIQUE |
| Max governance events recorded on any one trace | **1** — the ceiling the defect imposes |
| AI budget tables | **ABSENT** — 0 of 2 |
| `ai_tool_policy_logs.policy_version` | **ABSENT** |
| Retention categories (AI/automation/activity) | **ABSENT** — 0 of 3 |
| `ml_model_versions` (Phase-12 model registry) | **ABSENT** |
| `ml_shadow_predictions` | **ABSENT** |
| `knowledge_documents` (Phase-11 RAG) | **ABSENT** |
| `knowledge_authority_rules` | **ABSENT** |

**Production is 11 migrations behind** (107 on disk, 100 applied), spanning Phases 11, 12, 14 and 15:

```
20260609130000_baseline_repair_db_push_drift    20260906090000_ml_model_governance
20260817110000_notification_delivery_claim      20260907090000_phase14_governance
20260903090000_support_ai_recommendations       20260907090100_audit_trace_not_unique
20260904090000_knowledge_base                   20260907090200_retention_categories
20260905090000_knowledge_authority              20260907100000_partner_lifecycle_verified
20260908090000_phase15_workflow_drafts
```

**Rehearsed end-to-end** on a clone of production: `prisma migrate deploy` exit 0 in 25,966 ms,
100 → 111, zero data loss across 352,753 audit rows, clean application boot. See
`PHASE_15_PRODUCTION_MATURITY_AUDIT.md`.

The consequence for Phase 15 specifically: **there is no model registry in production**, so no
Phase-15 model could be governed there even if one were ready; **there is no budget table**, so AI
spend controls degrade to `BUDGET_UNAVAILABLE` (permissive by design, but not a control); and the
audit log still cannot hold more than one governance event per request.

**Verdict: `PHASE_15_BLOCKED_BY_PRODUCTION_MATURITY`.** All unblocked engineering continued.

---

## 1. Voice AI — `BLOCKED_BY_EXTERNAL_DEPENDENCY`

**Not built.** The feasibility audit was run first and the answer was no.

| Requirement | State |
|---|---|
| Configured AI providers | **GEMINI, GROQ only** (OpenAI and Anthropic keys absent) |
| STT adapter in the codebase | **none** — zero matches for speech/transcribe/STT/whisper across 579 backend files |
| TTS adapter | **none** |
| Streaming in the AI gateway | **none** — request/response only |
| Client audio capture | `expo-av` in **customer mobile only**; partner mobile has none; **no web audio at all** |
| Voice consent / retention policy | **does not exist** |

STT is *technically* reachable — Gemini accepts audio natively — but a voice assistant is not an
STT call. It needs TTS, streaming, barge-in and cancellation, and this platform has none of the
four. §6 is explicit: *"Do not expose fake streaming UX if the backend cannot actually stream."*

Building a request/response "voice" feature that records, waits, and plays back a canned response
would be exactly that. **Nothing was built.**

**To unblock:** a TTS provider decision, a streaming transport decision, web/partner audio capture,
and a voice consent + recording-retention policy. The last is a legal question, not an engineering
one.

---

## 2. Advanced Multimodal Assistant — `OPERATIONAL_WITH_POLICY_LIMITATIONS` (development)

**Downgraded from `COMPLETE_WITH_FOLLOWUPS` on re-audit.** §38 requires a *real downstream
consumer*; the earlier classification treated its absence as a follow-up. §38 is right — a
multimodal *assistant* implies the model's reading of an image informs a conversation, and here it
does not. A governed one-way image-analysis pipeline is a real capability, but it is not the
capability that was asked for.

**Deliberately not completed.** Feeding vision output into a prompt is precisely the step that
creates an indirect prompt-injection path: an attacker writes instructions into an image and they
arrive as model input. Doing it needs an injection-defence design and a policy decision about what
image content may influence — neither exists. Building it to satisfy a checkbox would trade a
verified-safe one-way pipeline for an unverified two-way one.

**Reused, not rebuilt.** `vision-intelligence.service` already exists and was brought under
governance in Phase 14 — rate limit, spend cap, cost accounting and AI audit at the call site,
after it was found calling Gemini directly.

**The injection surface is narrower than expected, and this is a measured finding rather than an
assumption.** A source-wide search for consumers of the vision output (`observations`,
`observedCategory`, `analyzeImage`, `VisionResult`) outside the vision service and its own route
returns **zero matches**. The pipeline is one-way: image in, structured analysis stored and
returned to the owner. Nothing re-ingests it into a prompt.

That means the classic image → OCR → prompt-injection path **does not exist today**, because there
is no second hop. The Phase-14 governance (which the Phase-15 bypass guard now protects with a test
that fails when reintroduced) is the substantive control.

**Follow-up:** the moment any consumer feeds vision output into an LLM prompt, that finding
expires. The bypass guard catches ungoverned *provider calls*, not ungoverned *content flow*.

---

## 3. Advanced Recommendation ML — `OPERATIONAL_WITH_DATA_LIMITATIONS`

**Reclassified after a second data audit.** The first pass called this `BLOCKED_BY_DATA` on the
basis of customer→service repeat bookings alone. That was right about that dataset and wrong as a
verdict on the platform — §35 requires searching the whole project before accepting a blocker, and
the first pass had not.

### What the second audit found

`assignment_attempts` holds **3,164 dispatch offers across 54 providers over 88 days**, each with a
real observed outcome: **236 ACCEPTED**, 2,904 TIMEOUT, 7 REJECTED. Ordering offers by predicted
acceptance is a ranking problem, and this is a genuine label — a provider's behaviour, not a rule's
own output.

**Built and evaluated** (`provider-acceptance.v1`, temporal split, two baselines, materiality):

```
candidate      : AUC 0.9528  Brier 0.0527
prior-rate rule: AUC 0.9642  Brier 0.0425     <-- the baseline WINS
base-rate      : AUC 0.5000  Brier 0.0814
materiality    : margin -0.0114 (-0.7 SE) -> NOT materially better
```

**An AUC of 0.95 that must not ship.** Predicting each provider's own historical acceptance rate
ranks *better* than the model. The reason is stark: **only 16 of 54 providers have ever accepted**,
and one accounts for **176 of the 236 acceptances**. Acceptance is provider identity, and the
per-provider rate captures it directly.

**Actionable outcome:** rank offers on observed per-provider acceptance rate; a learned model is not
warranted on this data. That is a measured recommendation, not an opinion.

### Customer→service personalisation — still `BLOCKED_BY_DATA`

Unchanged and re-measured:

| Signal | Value |
|---|---|
| Bookings | 522 |
| Distinct customers who have booked | 147 |
| Customers with **≥2** bookings | **30** |
| Customers with ≥5 bookings | 10 |
| Explicit ratings | **22** |
| Distinct services booked | 37 of 55 in catalogue |
| History span | 87 days |

**117 of 147 customers (80%) have booked exactly once.** Personalised ranking learns from repeat
behaviour, and four fifths of the population has none — cold-start is the dominant case, not the
edge case. With 22 ratings there is no explicit-feedback signal either.

A recommender trained on this would be a popularity ranker with a confidence score attached.
**Nothing was built**, per §8: *"If data is insufficient: do not fake a model."*

---

## 4. Sophisticated Fraud ML — `BLOCKED_BY_DATA`

**Not built.** This is the starkest of the three:

| Label source | Count |
|---|---|
| `fraud_alerts` | **0** |
| `fraud_risk_scores` | 1 |
| `financial_fraud_cases` | 1 |
| `fraud_decision_logs` | 6 |
| **`chargebacks`** (the only external ground truth) | **9** |
| `fraud_signals` (rule output, **not labels**) | 100 |

Nine confirmed-fraud-adjacent outcomes in the platform's entire history. A supervised fraud model
needs positives; there are nine, and the 100 fraud signals are the existing rule engine's own
output — training on them would teach a model to imitate the rules it was meant to improve on.

**Nothing was built.** The existing deterministic fraud services remain the control, and §9's
default posture (DETECT → SCORE → EXPLAIN → REVIEW → HUMAN DECISION) is unchanged.

---

## 5. Scenario Simulation — `COMPLETE` (development)

**Built as a governed wrapper, not a second engine.** `digitalTwinService.simulate` already
computes scenarios; reimplementing its arithmetic would guarantee two engines that eventually
disagree. `scenario-simulation.service` adds what a result needs before anyone acts on it.

**Three defects in the existing engine, surfaced rather than inherited:**

| # | Defect | Handling |
|---|---|---|
| 1 | `confidence: 0.8` **hardcoded**, never validated against an outcome | **Not passed through.** Replaced with `{ kind: "UNVALIDATED", basis: "DETERMINISTIC_MODEL_NO_BACKTEST" }`. A number that looks measured survives being read aloud in a meeting |
| 2 | Five **invented causal coefficients** — rain ×1.25, festival ×1.6, elasticity `exp(-0.6Δ)`, ETA penalty ×0.3, rain-traffic ×1.2 | Named individually with `basis: UNVALIDATED_PRIOR` and returned with every result. Deleting them would discard a working directional model; presenting them as fact was the defect |
| 3 | `freshness: new Date()` while the underlying twin is served through a **45-second cache** | Replaced with `{ observedAt, basis, maxStalenessSeconds, note }`. A bare timestamp cannot express "up to 45s old" |

**Reproducibility:** `scenarioId = sha256(city + normalised params + snapshotId + modelVersion)`.
Identical inputs against the same snapshot give the same id and the same answer; a moved baseline
gives a *different* id, because two incomparable runs sharing an id invites comparing them.

**Read-only:** verified by counting `bookings`, `payments` and `ledger_entries` before and after an
extreme scenario (+200% demand, −90% supply, festival) — unchanged.

---

## 6. Executive What-If — `COMPLETE` (development)

**Same engine, different presentation.** Capability 5 and 6 are one computation asked by two
audiences; two engines would eventually disagree.

Returns baseline / scenario / delta separately, with assumptions, limitations, data freshness,
model version, scenario id and the same honest confidence object.

**It refuses to produce a currency figure**, and this is deliberate. Converting `revenuePct` to
rupees means arithmetic outside the authoritative finance services, on a number resting on five
unvalidated priors, arriving in an executive report looking exactly like a ledger entry. The
percentage carries its provenance; a rupee amount would not. `financialProjection.available` is
`false` with that reason attached.

---

## 7. AI-Assisted Workflow Creation — `COMPLETE` (development)

**The architectural constraint is the feature.** Workflows here are **defined in code**;
`workflow_definitions` stores a frozen snapshot and the boot-time fingerprint check refuses to
start if an activated version's steps changed. There is therefore **no path by which a language
model can create something the engine executes**, and this service does not try to build one.

Drafts live in their own table (`ai_workflow_drafts`). The AI proposes, a person reviews, a
developer commits. Three parties, and the model has the least authority.

**Validation, against runtime-derived allowlists — never a hardcoded list:**

| Check | Source |
|---|---|
| Step type | 5 types the engine executes |
| Condition id | `listConditions()` — the executor's own registry |
| Trigger | `triggeredEventTypes()` |
| Notification type | `notification_templates` where `status = ACTIVE` |
| Recipient | `SUBJECT_CUSTOMER` / `SUBJECT_PARTNER` only |

**ACTION steps are refused outright.** None of the 25 code-defined workflows uses one and the
executor has no route into the tool layer, so an ACTION step does nothing today. The danger is
tomorrow: if that route opens, every drafted ACTION step becomes a way for a model to invoke a tool
nobody reviewed. **Verified by removal** — allowing ACTION in the step-type set makes the test fail.

Approval **re-validates** against the live registries (a draft that passed last week must not be
approvable if a condition has since been removed), requires a ≥10-character note, is audited
fail-closed, and returns `nextStep: "NOT YET RUNNING…"` because "APPROVED" on a screen invites the
assumption that something is now live.

---

## 8. Advanced Predictive Operations — `OPERATIONAL_WITH_DATA_LIMITATIONS` (development)

**One model built, and the honest result is that it should not be promoted.**

Cancellation risk was the only predictive target the data supported: **387 terminal bookings, 161
cancelled (41.6%)** — small, but a real, balanced label. (ETA was excluded: its 75 labels are
quarantined from Phase 12.)

**Measured on a temporal split** — never random, because a random split lets the model see bookings
made after the ones it is graded on:

```
split          : TEMPORAL  train=270 test=117 testPositives=32
train window   : 2026-06-09 -> 2026-08-24
test window    : 2026-08-24 -> 2026-09-04

candidate      : AUC 0.7085  Brier 0.2158
base-rate      : AUC 0.5000  Brier 0.2404
prior-rate rule: AUC 0.6945  Brier 0.2216

beats baseline : true   (auc:true brier:true)
materiality    : materiallyBetter=FALSE  margin=0.014  SE=0.057  (0.24 SE)
```

**The candidate beats both baselines and is still not worth promoting.** The AUC margin over the
obvious no-model rule is 0.014 against a Hanley–McNeil standard error of 0.057 — **a quarter of one
standard error**. `beatsBaseline` and `materiallyBetter` are reported separately precisely so they
cannot be collapsed, and the gauge published to Prometheus is the *materiality*, not the bare
comparison.

The dominant coefficient is `prior_cancel_rate` at 2.37 — the model is largely re-deriving the
baseline rule with a little extra from lead time and weekend.

*(The materiality check was added after the first run reported `beatsBaseline: true` with no error
bar. That verdict was arithmetically correct and practically meaningless, and shipping it would
have been the fake intelligence this phase forbids.)*

**Leakage:** 13 fields excluded with stated reasons, including four that reconstruct the target
(`cancelled_at`, `completed_at`, `cancellation_reason`, `cancelled_by`). Customer history is
accumulated in creation order so an example never sees its own future.

**Not serving.** No consumer, no registry entry, no shadow deployment. Stated in the response's own
`limitations`.

---

## Summary

| # | Capability | Status | Blocker |
|---|---|---|---|
| 1 | Voice AI | `BLOCKED_BY_EXTERNAL_DEPENDENCY` | No TTS/STT adapter, no streaming, no voice policy |
| 2 | Multimodal assistant | `OPERATIONAL_WITH_POLICY_LIMITATIONS` | Governed and safe, but **zero downstream consumers** — not an assistant |
| 3 | Recommendation ML | `OPERATIONAL_WITH_DATA_LIMITATIONS` | Provider ranking built + evaluated (baseline wins); customer→service still data-blocked |
| 4 | Fraud ML | `BLOCKED_BY_DATA` | 9 confirmed labels |
| 5 | Scenario simulation | `COMPLETE` | — |
| 6 | Executive what-if | `COMPLETE` | — |
| 7 | AI workflow creation | `COMPLETE` | — |
| 8 | Predictive operations | `OPERATIONAL_WITH_DATA_LIMITATIONS` | Two models built; neither materially better than its baseline; neither serving |

**Three built, two built-and-honestly-negative, one verified, two blocked with measured evidence.
None production LIVE**, because the production maturity gate fails on 11 unapplied migrations that
predate this phase.

**The two negatives are the phase's most useful output.** Both models were built properly, both
beat a naive baseline on raw metrics, and both were stopped by a materiality test that compared the
margin against its own error bar. Without that test, a 0.95 AUC and a "beats baseline: true" would
both have shipped.
