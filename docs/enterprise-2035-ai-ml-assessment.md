# HOMEEIGO — Enterprise 2035 AI / ML Assessment

The distinction this document exists to make: **"AI mentioned in code" vs "AI actually called at runtime."**

---

## 0. Headline

HOMEEIGO has built an unusually rigorous **AI governance platform** — budget reservation, tool approval, prompt firewall, provider failover, circuit breakers, audit trails, shadow evaluation. That machinery is real, executes, and is well engineered.

It currently governs **nothing**. No model-provider credential is configured, so every LLM call in this environment returns a canned dry-run string. The knowledge base is empty. Vision returns a deterministic fallback. The two genuine ML models are offline-evaluation-only and drive no decision.

The correct summary is not "the AI is fake." It is: **the control plane is built and proven; the inference plane has never been switched on.** That is a credentials-and-decision gap, not a rewrite.

---

## 1. LLM layer — MOCKED (environment-blocked)

### 1.1 The evidence

`src/ai/config.ts` resolves every provider key through a guard:

```ts
const aiKey = (v) => (liveProviderAllowed("HOMIGO_REQUIRE_AI") ? v : undefined);
```

and each adapter opens with the same branch (`src/ai/providers/model-providers.ts:105`):

```ts
if (aiConfig.dryRun || !anthropic.apiKey) return mockResponse("ANTHROPIC", anthropic.model, input, t0);
```

`mockResponse` (line 574) returns:

```ts
content: `[${provider} dry-run] Acknowledged: ${lastUser.content.slice(0,120)}`
```

Credential state, read from `apps/backend/.env`:

| Variable | State |
|---|---|
| `ANTHROPIC_API_KEY` | **absent** |
| `OPENAI_API_KEY` | **absent** |
| `GEMINI_API_KEY` | **absent** |
| `GROQ_API_KEY` | **absent** |
| `GOOGLE_APPLICATION_CREDENTIALS` | **absent** |
| `GCP_PROJECT_ID` | **absent** |

Gemini has a second transport (Vertex with application-default credentials) that would bypass the missing API key — but `GOOGLE_APPLICATION_CREDENTIALS` and `GCP_PROJECT_ID` are both absent too, so that path is closed as well.

**Conclusion:** every assistant surface in the platform — customer AI, partner AI, admin AI-brain, agents, support drafting — currently echoes the user's own words back with a `[GROQ dry-run] Acknowledged:` prefix.

### 1.2 Configuration reality

| Setting | Effective value | Source |
|---|---|---|
| Gateway enabled | **true** | `AI_GATEWAY_ENABLED !== "false"`, var absent |
| Dry run | false | `AI_GATEWAY_DRY_RUN === "true"`, var absent |
| Provider order | `GROQ → GEMINI → OPENAI` | default |
| Disabled providers | `["ANTHROPIC"]` | default — deliberately parked, documented as never having served live traffic |
| Total request deadline | 30 s | default |
| Cache | disabled | `AI_CACHE_ENABLED` absent |

The gateway is *on* and *not* in declared dry-run mode. It reaches the mock purely through key absence — which is the honest degradation path the adapters were designed for, but means nothing in the system announces "these answers are fake."

### 1.3 Cost metering meters the mock

`/metrics` reports `homigo_ai_daily_cost_usd 0.01435515` with no provider configured. The gateway estimates token cost from its own dry-run responses. Any dashboard or budget report reading this figure is describing imaginary spend.

**Finding AI-1 (P2, OBSERVABILITY):** AI cost and usage metrics do not distinguish real inference from dry-run. A `provider_mode="mock|live"` label on `homigo_ai_daily_cost_usd` and on gateway request counters would make the state self-evident.

### 1.4 What *is* real and exercised around the model call

These execute on every request regardless of whether the model is mocked, and they are genuinely good:

| Control | Location | Evidence |
|---|---|---|
| Budget reserve → settle/abandon | `src/ai/gateway/ai-gateway.ts:285-316` | `AiBudgetPolicy` + `AiBudgetWindow`; 402 `BUDGET_EXCEEDED`; double-release guarded by a settled flag |
| Budget admin surface | `GET/PUT /api/admin/governance/ai-budgets` | Returns explicit `NO_POLICY_CONFIGURED — AI spend is measured but not capped` rather than implying enforcement |
| Provider failover + cooldown | `src/ai/config.ts`, `model-providers.ts` | rate-limit 60 s, quota 900 s, ceiling 3600 s |
| Circuit breaker | `aiConfig.circuitBreaker` | threshold 5, reset 60 s, half-open 2 |
| Per-call deadline slicing | `callTimeoutMs()` | each attempt gets only the remaining shared budget |
| Prompt registry | 17 active prompts across 9 categories | `homigo_prompt_registry_total` |
| Prompt firewall | `src/lib/ai-brain-metrics.ts` | `homigo_prompt_blocked_total` |
| Tool governance | `src/ai-tools/` (approval, policy, security, audit, bridge, execution) | 115-entry tool catalogue; 13,146 `ai_tool_executions`, 13,108 `ai_tool_policy_logs` rows |
| Agent runtime | `src/agents/` (planning, policy, triggers, runtime, observability) | `AGENTS_ENABLED` absent → **fails closed, agents off by default** |

**Note on budget:** `AiGatewayUsage` is an orphan table (0 rows, no code). Enforcement uses `AiBudgetPolicy`/`AiBudgetWindow` instead. The orphan is stale schema, not a broken control — see `enterprise-2035-dead-code-report.md`.

---

## 2. Retrieval / RAG — BUILT, EMPTY

`src/services/knowledge-*.service.ts` implements a careful RAG stack: ingestion, chunking, embedding, retrieval, authority rules, answer synthesis, evaluation, analytics.

The embedding layer is notably well-reasoned — it records the model and dimension that produced each vector and **refuses to compare vectors from different models**, with a comment explaining that an earlier hardcoded `text-embedding-004` constant returned 404 against the real key's model list.

Live state:

| Table | Rows |
|---|---|
| `knowledge_documents` | **0** |
| `knowledge_chunks` | **0** |
| `knowledge_authority_rules` | **0** |

And `embeddingAvailable()` requires `GEMINI_API_KEY`, which is absent.

**Status:** `IMPLEMENTED_AND_WIRED` but inert. `POST /api/knowledge/ask`, `/retrieve` and `/scope` have **no frontend consumer** either (the admin console calls a different path, `/api/admin/knowledge/ask`).

**Finding AI-2 (P2, AI/ML):** The knowledge base is empty and its public endpoints are unconsumed. Either seed and wire it, or mark it dormant — today an operator cannot tell the difference between "no answer because nothing is indexed" and "no answer because retrieval failed."

---

## 3. Computer vision — DETERMINISTIC FALLBACK, no model

`src/services/vision-intelligence.service.ts` is admirably explicit about its own state (line 31):

> *"...a model. Until one is written, every analysis is produced by the deterministic fallback and is... The distinction matters more than the absence. A fallback result is a test of the pipeline; it is not a test of the model."*

`analyzeImage()` runs the full pipeline — upload, retention, audit, template accounting — and terminates in `fallbackAnalysis()`. `VISION_FORCE_FALLBACK` exists to pin that behaviour explicitly.

**Status:** `CONFIGURATION_ONLY` for intelligence; `ACTIVE_AND_EXECUTED` for the surrounding pipeline. Customer web has a matching `AiImageDiagnosis.tsx` that renders *"Photo diagnosis — coming soon"* — frontend and backend agree, which is the right behaviour.

---

## 4. Genuine ML models — REAL, but decision-free

Two models are actual statistics, trained in-process on Postgres data. Neither is a wrapper around an LLM.

### 4.1 `cancellation-risk.v1` — `src/services/cancellation-risk.service.ts` (361 lines)

Logistic regression, batch gradient descent with L2 (intercept unpenalised), evaluated with **AUC, Brier score and a Hanley–McNeil standard error**, scored against two baselines.

Its leakage discipline is the strongest engineering in the AI area — `EXCLUDED_FEATURES` names each excluded field *with a reason*:

> `payment_status` — *"EVOLVES — its value at prediction time differs from its value at read time."*

and examples are built in temporal order so "a customer's later cancellations cannot inform their earlier prediction."

**Consumers:** exactly one — `GET /api/admin/governance/models/cancellation-risk/evaluation`, which is **not called by any frontend**. Nothing in booking, dispatch or pricing reads a cancellation risk score.

### 4.2 `provider-acceptance` — `src/services/provider-acceptance.service.ts` (284 lines)

Same shared `trainLogistic` helper. Its header records why the obvious training set was rejected:

> *"`provider_match_scores` has 2,386 rows and looks like the obvious training set. It is unusable: ... training on them would teach a model to imitate the scorer it was meant to improve."*

Refuses to report when below `MIN_TRAIN + 50` usable examples.

**Consumers:** one admin evaluation endpoint, **no frontend consumer**.

### 4.3 What is *not* ML, and says so

| Component | Actual technique | Self-description |
|---|---|---|
| `revenue-anomaly.service.ts` | mean / stddev / coefficient of variation | *"`STATISTICAL` and never `ML`: there is no model here, no training window and no learned..."* |
| `eta-intelligence.service.ts` (913 lines) | label collection from completed bookings | *"Collects training labels from completed bookings. **NO ML inference**."* |
| `matching.service.ts` | weighted additive score: rating (0-30) + distance (0-25) + availability (0-20), config-driven weights | rule-based, correctly never called ML |
| `fraud-risk` / `partner-risk` / `financial-risk` | rule + signal scoring | rules |
| `service-recommendation` / `zone-recommendation` | deterministic rules | per project memory, `LOCATION_MATCH` was previously fabricated and removed |

**This honesty is a genuine asset.** Most codebases of this size label heuristics as AI. HOMEEIGO consistently does not.

### 4.4 ETA model

`homigo_eta_quality_score 69.6`, `eta_training_ready 4`, `eta_missing_labels 23`. Per project memory the candidate model reached 98.3 s MAE — 33 % worse than Google plus recalibration — and promotion is blocked. Consistent with what is observed: labels are collected, no inference is served.

---

## 5. MLOps — real registry, dead pipeline

`src/services/ml-registry.service.ts`, `ml-shadow.service.ts`, `mlops.service.ts`, plus `/api/admin/ml/*` provide model registry, version transitions, approval, promotion, rollback and shadow evaluation. `analytics/` holds the feature store, forecast services, freshness and versioning.

But the pipeline that would feed it **has not succeeded since 2026-08-19** — BigQuery billing is disabled. See `enterprise-2035-runtime-status.md` §4.2. Feature generation, forecasting and warehouse-backed evaluation are all downstream of a write that always fails.

`/api/admin/ml/demand/forecast`, `/api/admin/ml/shadow/*`, `/api/analytics/features/*`, `/api/analytics/quality`, `/api/analytics/freshness`, `/api/analytics/versions/*` — **none has a frontend consumer**.

---

## 6. Status table

| Capability | Built | Wired | Executes | Real model | Drives a decision | Status |
|---|---|---|---|---|---|---|
| AI gateway + failover | ✅ | ✅ | ✅ | ❌ mock | ❌ | ENVIRONMENT_BLOCKED |
| AI budget enforcement | ✅ | ✅ | ✅ | n/a | ✅ (402) | ACTIVE (no policy set) |
| AI tool governance | ✅ | ✅ | ✅ | n/a | ✅ | ACTIVE |
| Agent runtime | ✅ | ✅ | fail-closed off | ❌ | ❌ | CONFIGURATION_ONLY |
| Prompt registry + firewall | ✅ | ✅ | ✅ | n/a | ✅ | ACTIVE |
| Knowledge / RAG | ✅ | ✅ | inert | ❌ no key | ❌ | BUILT, EMPTY |
| Vision | ✅ | ✅ | ✅ fallback | ❌ | ❌ | CONFIGURATION_ONLY |
| cancellation-risk.v1 | ✅ | ✅ | on demand | ✅ | ❌ | EVALUATION-ONLY |
| provider-acceptance | ✅ | ✅ | on demand | ✅ | ❌ | EVALUATION-ONLY |
| ETA prediction | labels only | ✅ | ✅ | ❌ | ❌ | PARTIAL |
| Demand forecasting | ✅ | ✅ | ❌ | ❌ | ❌ | BROKEN (BigQuery) |
| Matching / dispatch | ✅ | ✅ | ✅ | rules | ✅ | ACTIVE — **rule-based, not ML** |
| Anomaly / fraud | ✅ | ✅ | ✅ | statistical | ✅ | ACTIVE — **not ML** |
| Recommendations | ✅ | partial | ✅ | rules | partial | PARTIAL |

---

## 7. Opportunity assessment

Judged against HOMEEIGO's **real** data volumes (704 bookings, 324 providers, 882 users, 401k audit rows). This is the decisive constraint: at this scale most supervised learning is not yet justified.

### HIGH CONFIDENCE — do these

| Opportunity | Why now | Data required | Path |
|---|---|---|---|
| **Turn on one LLM provider** | Every assistant surface is already built and governed; one key converts a large inert investment into a working feature | none | Add `GROQ_API_KEY` in a sandbox; verify `provider_mode=live`; watch budget |
| **Seed the knowledge base** | RAG stack complete, 0 documents | existing SOPs/policies | Ingest → embed → verify retrieval refuses cross-model vectors |
| **Promote `cancellation-risk` to a decision** | Model exists, is leakage-clean and evaluated | already collected | Use it to prioritise dispatch or trigger confirmation nudges; keep a shadow period |
| **ETA via a recalibrated external provider** | Own model is 33 % worse than Google; recalibration is cheaper than training | existing labels | Blend Google ETA + learned offset, as the promotion path already specifies |

### EXPERIMENT — small, reversible

- **Provider-acceptance ranking** in dispatch — shadow first; the model already refuses to report on thin data.
- **Support ticket classification** — 40 `SupportTicket` Prisma call-sites exist; volume unknown.
- **Semantic search over the catalogue** — only once embeddings are live; current search is Postgres `contains` and is adequate at this catalogue size.

### NOT YET JUSTIFIED

- **Demand forecasting** — blocked on BigQuery billing, and 704 bookings cannot support seasonal forecasting. Project memory records `SEASONAL` as already dead in the certified rules. Fix billing before modelling.
- **Churn / CLV** — memory records label leakage as the real cause of a suspicious R²=0.9994. Do not revive without rebuilding labels.
- **Computer vision for job verification** — needs a labelled image corpus that does not exist (52 `job_evidence` rows).
- **Conversational booking** — requires the LLM layer to be live and trusted first.
- **Dynamic pricing intelligence** — the engine exists but has **no frontend consumer at all** (`/api/pricing/quote`, `/surge-forecast`, `/experiment`). Wire and observe the deterministic engine before adding learning.

---

## 8. Governance gaps to close before live inference

1. **No `mock` vs `live` signal** — metrics, `/ready` and admin screens should state provider mode (Finding AI-1).
2. **No budget policy configured** — `enforcementState` currently reports `NO_POLICY_CONFIGURED`. Set a cap *before* the first real key.
3. **PII in prompts** — `src/ai/context/` is field-allowlisted and budget-bounded, and `events/core/pii.ts` exists; re-verify against a live provider, since a mocked call never leaves the process.
4. **Approval binding is order-sensitive** — per memory, the argument hash fails closed on argument reorder, and `NO_HANDLER` consumes an approval without writing an execution audit row. Both matter more once tools can actually act.
5. **Agents fail closed** (`AGENTS_ENABLED` absent) — correct default; make the enabling decision explicit and audited.
