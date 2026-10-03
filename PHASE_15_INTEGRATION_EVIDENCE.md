# PHASE 15 — Integration Evidence

§29 forbids claiming integration because a backend endpoint exists. This document states, per
capability, exactly how far the path actually reaches — and where it stops.

---

## A. The honest summary first

**Phase 15 added no customer-facing and no partner-facing surface.** Every capability built is
admin-gated and read-only or draft-only.

| Consumer | Phase-15 surface | Reality |
|---|---|---|
| Admin / web | 6 endpoints | **API + RBAC in development**; no admin UI screens were built |
| Customer app | none | Nothing consumes any Phase-15 output |
| Partner app | none | Provider-acceptance is offline; the assignment engine does not read it |
| Workers / scheduler | none | No Phase-15 background job |
| Events | none | No Phase-15 event producer or consumer |
| Grafana | 8 metrics on the existing exporter | No Phase-15 dashboard was built |

Claiming "integrated into customer and partner apps" would be false. Nothing there consumes it.

---

## B. Capability-by-capability, against §38 acceptance criteria

### 1. Voice AI — **not built**

§38 requires real input, STT, reasoning, TTS, governance, cost control, observability, failure
handling and integration. The platform has **none of STT, TTS or streaming**, `expo-av` on one
client only, and no voice consent policy. Nothing was built, so nothing is integrated.

### 2. Multimodal assistant — **`OPERATIONAL_WITH_POLICY_LIMITATIONS`**, reclassified

§38 requires "a real downstream consumer". There is **none** — a source-wide search for consumers of
vision output (`observations`, `observedCategory`, `analyzeImage`, `VisionResult`) outside the
vision service and its own route returns **zero matches**.

| Criterion | State |
|---|---|
| Real image input | ✓ `POST /api/vision/images/:imageId/analyze` |
| Real model reasoning | ✓ Gemini vision, real token usage |
| Governance | ✓ rate limit · budget · cost · audit (Phase 14) |
| Security | ✓ ownership, MIME allowlist, size cap, retention |
| **Downstream LLM consumer** | ✗ **none exists** |
| Real user flow | ✓ image owner receives the analysis |

**Downgraded from `COMPLETE_WITH_FOLLOWUPS`.** The earlier classification treated "no consumer" as a
follow-up; §38 treats it as disqualifying, and §38 is right — a multimodal *assistant* implies the
model's reading of the image informs a conversation, and here it does not.

**Deliberately not built.** Feeding vision output into a prompt is the exact step that creates an
indirect prompt-injection path — an attacker writes instructions into an image and they arrive as
model input. Building that needs an injection-defence design and a policy decision about what image
content may influence, neither of which exists. Building it to satisfy a checkbox would trade a
verified-safe one-way pipeline for an unverified two-way one.

### 3. Recommendation — **`OPERATIONAL_WITH_DATA_LIMITATIONS`**

| Criterion | State |
|---|---|
| Sufficient valid data | ✓ 3,164 offers, 236 acceptances, 88 days |
| Valid model | ✓ logistic regression, temporal split |
| Meaningful evaluation | ✓ two baselines + materiality |
| **Real serving path** | ✗ **offline only** |
| Real user integration | ✗ the assignment engine does not consume it |
| Governance | ✓ evaluation is RBAC-gated; no registry entry (nothing to promote) |
| Feedback / drift monitoring | ✗ not serving, so nothing to drift |

**Not integrated, and correctly so:** the evaluation says the model is *worse* than the per-provider
rate baseline. Wiring a model into the assignment engine that loses to the rule it replaces would be
the opposite of integration.

### 4. Fraud ML — **not built** · `BLOCKED_BY_DATA` (9 labels)

### 5. Scenario simulation — **`COMPLETE`** (development)

| Criterion | State |
|---|---|
| Sandbox | ✓ writes nothing — verified by counting bookings/payments/ledger |
| Reproducibility | ✓ `scenarioId` = sha256(city + params + snapshot + model version) |
| Real data | ✓ live twin aggregates |
| Assumptions | ✓ 6 named, 5 marked `UNVALIDATED_PRIOR` |
| No production mutation | ✓ verified |
| Usable API | ✓ `POST /api/digital-twin/:city/scenario` |
| Observability | ✓ 2 metrics |

**Gap against §13's "usable UI":** the API is complete; **no admin screen was built**. Scenario
creation, comparison and history exist as endpoints, not as an interface.

### 6. Executive what-if — **`COMPLETE`** (development)

| Criterion | State |
|---|---|
| Executive integration | ✓ extends the existing digital twin; admin-gated |
| Read-only | ✓ verified |
| Transparent assumptions | ✓ returned with every result |
| Valid calculations | ✓ existing engine, unmodified |
| Provenance | ✓ `scenarioId`, `snapshotId`, `modelVersion`, `dataFreshness` |
| Uncertainty | ✓ `confidence: UNVALIDATED` — the engine's hardcoded 0.8 is not passed through |
| **No fake finance** | ✓ `financialProjection.available: false` |

Same UI gap as §5.

### 7. AI workflow creation — **`COMPLETE`** (development)

| Criterion | State |
|---|---|
| Draft generation | ✓ accepts a structured draft |
| Validation | ✓ against runtime registries |
| Allowlisted actions | ✓ 5 step types; ACTION refused |
| Diff | ~ full validation record stored; no visual diff UI |
| Human approval | ✓ `SETTINGS/APPROVE`, ≥10-char note, fail-closed audit |
| Versioning | ✓ via the code-defined workflow registry |
| Shadow / test | ✓ inherited — definitions carry `executionMode: SHADOW` |
| Activation | ✓ **requires a developer commit** — by design |
| Rollback | ✓ drafts are proposals; rejecting one changes nothing |
| Audit | ✓ approve and reject, fail-closed with compensation |

### 8. Predictive operations — **`OPERATIONAL_WITH_DATA_LIMITATIONS`**

Two models, both evaluated, **neither serving**:

| Model | Labels | Result |
|---|---|---|
| `cancellation-risk.v1` | 387 terminal bookings, 161 cancelled | AUC 0.7085 vs baseline 0.6945 — **0.24 SE, not material** |
| `provider-acceptance.v1` | 3,164 offers, 236 accepted | AUC 0.9528 vs baseline 0.9642 — **baseline wins** |

| Criterion | State |
|---|---|
| Valid data | ✓ both |
| Valid model / baseline | ✓ two baselines each |
| Temporal evaluation | ✓ both |
| **Serving** | ✗ neither |
| Downstream integration | ✗ none |
| Stale protection | n/a — nothing serves |
| Observability | ✓ 4 metrics, publishing **materiality** |
| Rollback / governance | ✓ no registry entry; nothing to roll back |

---

## C. Verified integration paths

What *was* proven end-to-end:

| Path | Evidence |
|---|---|
| Route → RBAC → service → response | 6 endpoints mapped in `admin-route-permissions`; unmapped `/api/admin/*` denies by default |
| Service → database → persistence | `ai_workflow_drafts` migration applied to `homigo_p39` and `homigo_test`; drafts created, reviewed, raced |
| Service → audit → durable record | Draft approval writes `AI_WORKFLOW_DRAFT_APPROVED`; fail-closed verified against a real audit outage |
| Service → metrics → exporter | 8 metrics on the existing Prometheus registry |
| Migration → application boot | Backend booted against a **migrated clone of production**, 0 error lines, workflow fingerprint gate passed |
| Governance on production data | 10 events on one trace stored on a production clone, where production today permits 1 |

**An RBAC gap this pass found and fixed:** the two model-evaluation routes were mounted but **never
mapped** in `admin-route-permissions`. Because unmapped `/api/admin/*` routes are denied by default,
both endpoints were unreachable — a safe failure, and still a broken integration. Both are now
mapped.

---

## D. What "operational" means here

| Term | Meaning in this document |
|---|---|
| **Built** | Service exists, typechecks, tested |
| **Integrated (dev)** | Reachable through a real route with RBAC, persisting to a real table |
| **Serving** | Something consumes its output — **no Phase-15 model is serving** |
| **Production LIVE** | Verified in production — **nothing in Phase 15 is** |

Phase 15 reaches **Integrated (dev)** for capabilities 5, 6 and 7; **Built and evaluated, not
serving** for 3 and 8; **Governed but without a consumer** for 2; and **not built** for 1 and 4.
