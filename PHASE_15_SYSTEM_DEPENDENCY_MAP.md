# PHASE 15 — System Dependency Map

What each capability actually touches, traced by source search rather than assumed from design.

---

## A. Provider call graph — every path to a paid AI provider

Traced two ways, because one way missed a real bypass. Searching by **adapter name** found the
vision path; searching by **provider hostname** found the embedding path that no adapter name
appears in.

```
                        ┌──────────────────────────────┐
   text generation ────▸│ invokeAiGateway              │
                        │  validate → authorize        │
                        │  → rate limit → prompt sec.  │
                        │  → BUDGET reserve            │
                        │  → routeModelRequest         │──▸ callGroq / callGemini
                        │  → BUDGET settle → audit     │    callOpenAi / callAnthropic
                        └──────────────────────────────┘
                                                            (ai/router/model-router.ts
                                                             is the ONLY caller)

   vision  ───▸ vision-intelligence.service ──▸ callGeminiVision
                  rate limit · budget reserve/settle · cost · audit          [governed P14]

   embeddings ─▸ knowledge-embedding.service ─▸ raw fetch → generativelanguage.googleapis.com
                  rate limit · unknown-cost accounting · audit               [governed P15]
```

| Path | Callers outside the router | Rate limit | Spend | Audit |
|---|---|---|---|---|
| Adapter functions | none | — | — | — |
| `callGeminiVision` | `vision-intelligence.service` | ✓ | reserve/settle | ✓ |
| Raw `fetch` to Gemini | `knowledge-embedding.service` | ✓ | **unknown-cost** | ✓ |
| `ai/config.ts` | holds base URLs; calls nothing | allowlisted | — | — |

**No ungoverned provider path exists.** A regression guard walks all backend source files, matches
both adapter names and provider hosts, asserts its own coverage, and was verified by reintroducing
each bypass.

---

## B. Capability → dependency

### 5 & 6 — Scenario simulation / Executive what-if

```
ADMIN ─▸ POST /api/digital-twin/:city/{scenario|what-if}   requireRole("ADMIN")
           ▼
      scenarioSimulationService
           ├─▸ digitalTwinService.cityTwin()     read — for real freshness (45s cache)
           └─▸ digitalTwinService.simulate()     the EXISTING arithmetic, unchanged
           ▼
      { scenarioId, snapshotId, baseline, projected, delta,
        assumptions[6], limitations[5], confidence: UNVALIDATED,
        dataFreshness: { observedAt, basis, maxStalenessSeconds } }
```

**Writes nothing.** Imports the twin, metrics and the logger — no repository, no finance service,
no workflow entry point. Verified by counting `bookings` / `payments` / `ledger_entries` before and
after an extreme scenario.

### 7 — AI-assisted workflow creation

```
INTENT ─▸ (generator) ─▸ aiWorkflowDraftService.createDraft
                              ▼
                         VALIDATE against RUNTIME registries
                           listConditions()          ← condition-registry
                           triggeredEventTypes()     ← trigger-registry
                           notification_templates    ← status = ACTIVE only
                           ACTION step type          → REFUSED
                              ▼
                         ai_workflow_drafts (DRAFT, riskClass, validation, promptHash)
                              ▼
                         HUMAN REVIEW  ── re-validates against live registries
                              │           ≥10-char note · SETTINGS/APPROVE
                              │           recordGoverned (FAIL-CLOSED, compensating)
                              ▼
                         APPROVED — "NOT YET RUNNING"
                              ▼
                         DEVELOPER commits the code definition → deploy → registry sync
```

**Deliberately not connected** to `workflow_definitions`. Workflows are code-defined and the boot
fingerprint check refuses to start on a mutated activated version, so there is no path from a model
to something the engine runs. That constraint is the safety property, not an obstacle.

### 8 & 3 — Predictive operations / provider ranking

```
bookings (terminal) ──▸ cancellationRiskService ──┐
                                                  ├──▸ lib/ml-evaluation
assignment_attempts ──▸ providerAcceptanceService ┘     trainLogistic · auc · brier
                                                        aucStandardError · assessMateriality
                                                  ▼
                    GET /api/admin/governance/models/{cancellation-risk|provider-acceptance}/evaluation
                                                  ANALYTICS/READ
```

**Neither serves anything.** No consumer, no ML-registry entry, no shadow deployment — stated in
each response's own `limitations` as `NOT_SERVING`.

---

## C. Reused, not rebuilt

| System | Phase-15 use |
|---|---|
| AI Gateway · router · failover | untouched |
| AI budget · rate limit · cost · audit | reused; embeddings added to coverage |
| RBAC + `admin-route-permissions` | 6 entries added to the existing table |
| `AuditLogService.recordGoverned` | reused for draft review |
| Workflow engine + registries | **read** for allowlists; engine untouched |
| Digital twin | wrapped, not reimplemented |
| ML registry | read; deliberately not written to |
| Prometheus exporter | 8 metrics added |
| Finance services | reused **by not calling them** — what-if refuses currency conversion |

**No second gateway, budget engine, RBAC, audit system, workflow engine, scheduler, model registry,
recommendation framework, fraud framework, forecast framework or observability stack was created.**

`lib/ml-evaluation.ts` is the one new shared module, extracted because two models needed the same
AUC standard error — and two drifting implementations of *that* statistic is a governance failure in
maths costume.

---

## D. Surfaces by consumer

| Consumer | Phase-15 surface | State |
|---|---|---|
| **Admin / web** | scenario, what-if, workflow drafts, model evaluations | API + RBAC in development |
| **Customer app** | none | Nothing customer-facing was built |
| **Partner app** | none | Provider-acceptance is offline and does not reach the assignment engine |
| **Operations** | stuck-workflow recovery (Phase 14) | unchanged |
| **Workers / scheduler** | none | No Phase-15 background job |
| **Events** | none | No Phase-15 event producer or consumer |

**Stated plainly:** Phase 15 added **no customer-facing and no partner-facing surface**. Every
capability built is admin-gated and read-only or draft-only. Claiming end-to-end integration into
customer or partner apps would be false — nothing there consumes any of it.

---

## E. Where an unbuilt capability would have attached

| Capability | Attachment point that exists | Missing dependency |
|---|---|---|
| Voice AI | `expo-av` in customer mobile; AI gateway | STT/TTS adapter, streaming transport, consent policy |
| Multimodal assistant | `vision-intelligence.service` (governed) | A downstream LLM consumer — **zero exist today** |
| Fraud ML | `fraud-risk.service`, `fraud_signals` | Adjudicated labels — 9 exist |
| Customer→service recommendation | `service-recommendation.service` | Repeat-booking depth |

---

## F. Data dependencies, measured

| Source | Rows | Used for |
|---|---|---|
| `assignment_attempts` | **3,164** | Provider acceptance — real outcomes |
| `bookings` (terminal) | 387 | Cancellation risk |
| `provider_match_scores` | 2,386 | **Rejected** — `booking_id` entirely NULL |
| `fraud_signals` | 100 | **Rejected** — rule output, not labels |
| `chargebacks` | 9 | Insufficient |
| `ratings` | 22 | Insufficient |
| Digital twin aggregates | live | Simulation baseline |
| Condition / trigger / template registries | runtime | Draft validation allowlists |

`pg_stat_user_tables` was **not** trusted for counts — it reported 7 bookings against a real 529.
Every figure is a `count(*)`.
