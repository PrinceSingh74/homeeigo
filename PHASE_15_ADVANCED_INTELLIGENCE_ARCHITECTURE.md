# PHASE 15 — Advanced Intelligence Architecture

## A. What was added, and what was deliberately not

Three services, one table, two route groups. Everything else is reuse.

| Added | Purpose |
|---|---|
| `services/scenario-simulation.service.ts` | Governed wrapper over the existing twin — capabilities 5 and 6 |
| `services/ai-workflow-draft.service.ts` | Draft-and-review pipeline — capability 7 |
| `services/cancellation-risk.service.ts` | Offline model + honest evaluation — capability 8 |
| `ai_workflow_drafts` table | Proposal staging, deliberately separate from `workflow_definitions` |
| `/api/digital-twin/:city/{scenario,what-if}` | Simulation surface |
| `/api/admin/governance/{workflow-drafts,models/...}` | Drafting and evaluation surface |

**Not created**, per §3 — each of these already exists and was extended or called:

AI Gateway · provider failover/router · AI budget control · AI rate limiting · AI audit ·
RBAC · admin route-permission table · audit service · workflow engine · workflow registry ·
condition registry · trigger registry · notification template registry · scheduler · EventOutbox ·
approval engine · ML model registry · shadow framework · digital twin · fraud services ·
recommendation services · forecast services · Prometheus/Grafana · feature flags · finance/ledger.

---

## B. Capability 5 & 6 — one engine, two presentations

```
ADMIN ─▸ POST /digital-twin/:city/{scenario|what-if}
             │  requireRole("ADMIN")
             ▼
       scenarioSimulationService
             │
             ├─▸ digitalTwinService.cityTwin(city)   ── read, for real freshness
             └─▸ digitalTwinService.simulate(...)    ── the EXISTING arithmetic, unchanged
             │
             ▼
    ┌────────────────────────────────────────────┐
    │ scenarioId  = sha256(city+params+snapshot) │
    │ snapshotId  = sha256(baseline)             │
    │ assumptions = 6, each with its provenance  │
    │ confidence  = { kind: "UNVALIDATED" }      │
    │ freshness   = { observedAt, maxStaleness } │
    │ limitations = 5                            │
    └────────────────────────────────────────────┘
```

**Why a wrapper rather than a rewrite.** The twin's arithmetic works and is used elsewhere.
Reimplementing it would produce two engines that disagree the first time one is edited. What the
existing engine lacked was not maths but provenance:

| Engine returned | Wrapper returns | Why |
|---|---|---|
| `confidence: 0.8` (hardcoded) | `{ kind: "UNVALIDATED", basis: "DETERMINISTIC_MODEL_NO_BACKTEST" }` | Never validated against an outcome. A number that looks measured survives being read aloud |
| coefficients applied silently | 6 named assumptions, 5 marked `UNVALIDATED_PRIOR` | Rain ×1.25, festival ×1.6, elasticity `exp(-0.6Δ)` are priors, not measurements |
| `freshness: new Date()` | `{ observedAt, basis, maxStalenessSeconds: 45 }` | The twin is cached 45s; a bare timestamp cannot say "up to 45s old" |
| no id | `scenarioId` + `snapshotId` | Reproducibility, and refusing to let incomparable runs share an id |

**Executive what-if refuses to produce currency.** Converting `revenuePct` to rupees would be
arithmetic outside the authoritative finance services on a number resting on five unvalidated
priors, landing in a report looking like a ledger figure.

---

## C. Capability 7 — the AI has the least authority

```
INTENT (free text)
   │
   ▼
LLM / caller ── proposes { proposedId, name, trigger, steps[] }
   │
   ▼
VALIDATE ── against RUNTIME registries, never a hardcoded list
   │          listConditions() · triggeredEventTypes() · ACTIVE notification templates
   │          ACTION step type → REFUSED
   ▼
ai_workflow_drafts  (status=DRAFT, riskClass, full validation record, promptHash)
   │
   ▼
HUMAN REVIEW ── re-validates against LIVE registries
   │             ≥10-char note required
   │             audited via recordGoverned (FAIL-CLOSED)
   │             optimistic update: exactly one reviewer wins
   ▼
APPROVED ── "NOT YET RUNNING"
   │
   ▼
DEVELOPER commits the code definition ─▸ deploy ─▸ registry sync ─▸ activation
```

**The constraint that makes this safe.** Workflows are defined in code. `workflow_definitions` is a
frozen snapshot and the boot fingerprint check refuses to start if an activated version's steps
changed. So there is **no path** by which a model creates something the engine runs — and the
service does not attempt to build one. Three parties are involved and the model has the least
authority of the three.

**Why drafts get their own table.** Writing AI-generated rows into `workflow_definitions` would
either be ignored by the engine or break boot, and would blur the one line that matters: a
definition the platform executes exists because a person committed it.

---

## D. Capability 8 — evaluation as the deliverable

```
bookings (terminal only)
   │  ordered by created_at
   ▼
FEATURE BUILD ── history counters advance AFTER each example  ◂── the leakage guard
   │             13 fields excluded (4 reconstruct the target)
   ▼
TEMPORAL SPLIT ── 70 / 30 by time, never random
   │
   ├─▸ train ─▸ logistic regression (batch GD, L2, bias unregularised)
   │
   ▼
EVALUATE vs TWO baselines
   │   base-rate      → the bar for Brier (calibration)
   │   prior-cancel   → the bar for AUC   (ranking)
   ▼
MATERIALITY ── Hanley–McNeil SE; margin must exceed 1.96·SE
   │
   ▼
homigo_cancellation_model_materially_better   ◂── the gauge publishes THIS, not beatsBaseline
```

**Why two baselines.** A base rate has no discrimination by construction (AUC 0.5), so beating it
on ranking proves nothing; it is well calibrated, so it is the right bar for Brier. The
prior-cancellation-rate rule is what you would do without a model, so it is the right bar for AUC.

**Why materiality is separate from `beatsBaseline`.** The first run returned `beatsBaseline: true`
on a margin of 0.014 AUC with 32 holdout positives. Arithmetically correct, practically
meaningless — the standard error is 0.057, so the margin is 0.24 SE. Reporting the first without
the second is the fake intelligence this phase forbids, so both are returned and the *metric* is
the materiality.

---

## E. Governance inheritance

Every Phase-15 surface inherits, rather than re-implements:

| Control | Inherited from | Applies to |
|---|---|---|
| RBAC + deny-by-default | `admin-route-permissions` | drafting, evaluation routes |
| Role gate | `requireRole("ADMIN")` | simulation routes |
| Fail-closed governance audit | `AuditLogService.recordGoverned` (Phase 14) | draft approve/reject |
| AI spend cap | `ai-budget.service` (Phase 14) | any provider call, incl. vision |
| AI rate limit | `ai-rate-limit` | same |
| Log PII scrubbing | `logger.scrubText` (Phase 14) | all Phase-15 logging |
| Metrics | existing Prometheus registry | simulation, drafting, model gauges |

---

## F. Metrics added

| Metric | Type | Meaning |
|---|---|---|
| `homigo_simulation_runs_total{city,kind}` | counter | scenario vs what-if |
| `homigo_simulation_duration_seconds{city}` | histogram | latency |
| `homigo_ai_workflow_drafts_total{risk,valid}` | counter | proposals by risk class |
| `homigo_ai_workflow_draft_reviews_total{decision,risk}` | counter | human decisions |
| `homigo_cancellation_model_auc{model}` | gauge | measured AUC |
| `homigo_cancellation_model_materially_better{model}` | gauge | **materiality**, not the bare comparison |

No new observability stack; these register with the existing Prometheus exporter.

---

## G. Environment status

| | State |
|---|---|
| Development | **Operational** — all three services integrated, routed, RBAC-mapped, tested |
| Test (`homigo_test`) | Migration applied; 29/29 Phase-15 tests pass |
| Staging | Not applied |
| **Production** | **Not applied, and blocked.** 10 migrations behind, including the Phase-12 model registry and all of Phase 14 |

"Operational" here means integrated and functioning in development. It is not production LIVE, and
this document does not use the two interchangeably.
