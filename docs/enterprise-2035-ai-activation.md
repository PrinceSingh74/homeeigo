# HOMEEIGO — AI Activation Readiness

**Status: CONTROL PLANE `RUNTIME_VERIFIED` · INFERENCE PLANE `EXTERNAL_BLOCKED` (no provider credential) · COST TRUTH `FIXED`**

---

## 1. The distinction this document exists to hold

HOMEEIGO has a genuinely rigorous **AI control plane** — budget reservation, tool approval, prompt firewall, provider failover, circuit breakers, fail-closed agents. It executes on every request and is well engineered.

It currently governs **nothing**. No provider credential is configured, so every completion is a canned dry-run string.

**The control plane is built and proven. The inference plane has never been switched on.** That is a credentials-and-decision gap, not a rewrite.

---

## 2. Re-measured capability state

| Provider | Credential | `liveInferenceConfigured()` |
|---|---|---|
| `GROQ` (primary) | absent | **false** |
| `GEMINI` | `GEMINI_API_KEY` absent, `GOOGLE_APPLICATION_CREDENTIALS` absent | **false** |
| `OPENAI` | absent | **false** |
| `ANTHROPIC` | absent, **and** parked by default via `AI_DISABLED_PROVIDERS` | **false** |

Gateway is `enabled` (default true) and **not** in declared dry-run mode. It reaches the mock purely through key absence — the honest degradation path the adapters were designed for, but nothing in the system announced it.

Evidence path: `src/ai/config.ts` resolves every key through `aiKey()`; each adapter opens with `if (aiConfig.dryRun || !<provider>.apiKey) return mockResponse(...)` (`model-providers.ts`).

---

## 3. AI-1 (P1, OBSERVABILITY) — dry-runs were billed as real spend — **FIXED**

### What was wrong

`mockResponse()` returned the same shape as a real completion, with plausible token counts and no marker. By the time it reached accounting it was indistinguishable from a real answer, so the gateway priced it and `homigo_ai_daily_cost_usd` aggregated the result.

On 2026-09-21 that gauge read **$0.01435515** on a deployment with **no AI credential configured at all**. Every cent was imaginary, and no series on any dashboard said so.

`ai_gateway_requests` has no column recording whether a response was mocked, so the fiction was not recoverable after the fact either.

### The fix

| Change | File |
|---|---|
| `AiProviderResponse.mocked?: boolean` | `ai/types.ts` |
| `mockResponse()` sets `mocked: true` | `ai/providers/model-providers.ts` |
| Actual cost forced to `0` for a mock | `ai/gateway/ai-gateway.ts` |
| Estimate reported on its own series | `lib/ai-metrics.ts` |
| `liveInferenceConfigured(provider)` — same condition the adapters use | `ai/config.ts` |
| Tool-loop results carry `mocked` too | `ai/gateway/ai-gateway.ts` |

Resulting series:

| Metric | Meaning |
|---|---|
| `homigo_ai_daily_cost_usd` | **money that actually left the account** |
| `homigo_ai_mocked_responses_total{provider,role}` | dry-runs served — non-zero means the assistant is answering, and not with a model |
| `homigo_ai_mocked_estimated_cost_usd_total{provider,role}` | what the same traffic **would** cost once a key exists |

Nothing is lost: the estimate is still available, it simply no longer shares a series with spend.

> **The tool-loop branch was caught by `tsc`, not by inspection.** A tool loop assembles its own result shape across several turns and does not carry the adapter's flag, so it would have remained the one path still billing a dry-run as real spend. It now derives `mocked` from `liveInferenceConfigured()`.

### Tests

`src/__tests__/ai-cost-truth.test.ts` — 6 assertions, including that `recordMockedResponse` never touches the spend gauge, and that with every credential unset `liveInferenceConfigured()` is false for all four providers.

Regression: **52 pass / 0 fail** across 5 AI suites.

---

## 4. What is real and executing around the model call

These run on every request regardless of whether inference is mocked, and are genuinely good:

| Control | Evidence |
|---|---|
| Budget reserve → settle/abandon | `ai-gateway.ts:285-316`; 402 `BUDGET_EXCEEDED`; double-release guarded by a settled flag |
| Budget admin surface | Returns `NO_POLICY_CONFIGURED — AI spend is measured but not capped` rather than implying enforcement |
| Provider failover + cooldown | rate-limit 60 s, quota 900 s, ceiling 3600 s |
| Circuit breaker | threshold 5, reset 60 s, half-open 2 |
| Per-call deadline slicing | each attempt gets only the remaining shared budget |
| Prompt firewall | `homigo_ai_prompt_blocked` by category |
| Tool governance | 115-tool catalogue; **13,146** `ai_tool_executions`, **13,108** `ai_tool_policy_logs` rows |
| Agent runtime | `AGENTS_ENABLED` absent → **fails closed** |
| Rate limiting | now **refused in deployed environments** if `AI_RATE_LIMIT_BYPASS` / `AI_TOOL_CERTIFICATION_MODE` are set (SEC-9) |

---

## 5. Activation gate — what must be true before a key is added

Ordered. Each is a precondition for the next.

| # | Gate | Status |
|---|---|---|
| 1 | Cost metrics distinguish actual from estimated | **DONE** |
| 2 | Deployed environments refuse AI bypass flags | **DONE** (SEC-9) |
| 3 | A budget policy is configured | **OPEN — owner decision.** Enforcement works; no cap is set. `enforcementState` honestly reports `NO_POLICY_CONFIGURED` |
| 4 | Budget UI reachable | **OPEN** — `GET/PUT /api/admin/governance/ai-budgets` has no consumer |
| 5 | PII scrubbing verified against a **live** call | **OPEN** — `ai/context/` is field-allowlisted and budget-bounded, but a mocked call never leaves the process, so the scrub has never been exercised end to end |
| 6 | Approval binding reviewed | **OPEN** — argument hash is order-sensitive (fails closed), and `NO_HANDLER` consumes an approval without writing an execution audit row |
| 7 | One provider enabled in a sandbox | **EXTERNAL_BLOCKED** — needs a credential |
| 8 | `homigo_ai_mocked_responses_total` falls to 0 | verification step for #7 |

**Gates 3–6 are engineering/decision work that can complete before any credential exists.** Only 7 is externally blocked, and it must not be done first: turning on inference before a budget cap and a verified PII scrub is the wrong order.

---

## 6. ML models — unchanged, and correctly classified

Two genuine logistic regressions (`cancellation-risk.v1`, `provider-acceptance`), trained in-process on Postgres data, evaluated with AUC, Brier and a Hanley–McNeil standard error, with explicit leakage exclusions.

**Both remain EVALUATION-ONLY.** Each is reachable through exactly one admin endpoint, and **neither endpoint has a frontend consumer**. Nothing in booking, dispatch, pricing or refunds reads either score.

Per Phase 12, neither may be connected to refunds, payouts, money or customer eligibility without an explicit validated policy. No such connection was made.

Everything else marketed as intelligence is rules or statistics, and the codebase says so itself — `revenue-anomaly` declares itself *"`STATISTICAL` and never `ML`"*; `eta-intelligence` states *"NO ML inference"*.

---

## 7. Status

| Item | Status |
|---|---|
| Control plane | **RUNTIME_VERIFIED** |
| Inference plane | **EXTERNAL_BLOCKED** — no credential |
| Cost truth (actual vs estimated vs mock) | **FIXED + TEST_VERIFIED** |
| Tool-loop cost parity | **FIXED** |
| Deployed-environment bypass refusal | **FIXED** |
| Budget policy configured | **BUSINESS_DECISION** |
| Budget UI | **DISCONNECTED** |
| PII scrub against live inference | **BLOCKED on #7** |
| Knowledge base / RAG | **BUILT, EMPTY** — 0 documents, embedding needs `GEMINI_API_KEY` |
| Vision | **CONFIGURATION_ONLY** — deterministic fallback, honestly labelled in code and UI |
| ML models | **EVALUATION-ONLY** — drive no decision, by design |

---

## Pass 6 note (2026-09-21)

- **No-policy behaviour is now environment-aware.** `ai-budget.service` returned `allowed: true` with
  `NO_POLICY_CONFIGURED` everywhere. On a deployed host (`isDeployedEnvironment()`: production, or
  the `NODE_ENV=development` + `APP_ENV=staging` pair `.env.staging` ships) it now **refuses** with
  `BUDGET_POLICY_REQUIRED` (HTTP 402); a developer machine stays permissive so local work is not
  blocked. `phase14-governance.test.ts` pins both, and the refusal test fails when the branch is
  reverted. The cap amount is still the owner's — none was invented; 0 policies remain.
- **Real spend, measured from `ai_gateway_requests`:** last 24 h **$0.0144 / 39 requests**; last 7
  days Groq CUSTOMER 11 ($0.0186), Groq SUPPORT 6 ($0.0146), Gemini SYSTEM 30 ($0.0000).
- **The 30 Gemini SYSTEM calls were caused by this pass.** All are `knowledge.embed` between 09:28
  and 09:37 UTC — the exact window of `scripts/sweep-authenticated-gets.ts`, which called
  `GET /api/admin/knowledge/evaluation` (twice). That route runs `knowledgeEvalService.run()`: 17
  golden questions, each embedded live through Gemini. Classification of the spend: ENVIRONMENTAL
  (self-inflicted). Finding, **P3**: a GET that performs 17 external provider calls per request is
  a read with side effects and cost; it should be a POST (or return a cached last run) and sit
  under a rate limit. Embeddings are metered by request count (`recordEmbeddingSpend`), with
  `cost_usd = 0` and `tokens = 0` on the audit row **by design** — that is documented, not a gap.
