# ADR-020 — Ordered Multi-Provider AI Failover (Groq primary · Gemini · OpenAI)

**Status:** Accepted · **Date:** 2026-08-10 · **Revised:** 2026-08-10 (V1 provider strategy)
**Supersedes:** the two-provider routing decision in [ADR-015](./adr-015-phase-3-enterprise-ai-core.md)
**Related:** [ADR-019](./adr-019-phase-3-ai-gateway-integration.md) · [Security review](../security/PHASE-3-AI-GATEWAY-SECURITY.md)

---

## Context

The AI Gateway routed to exactly two providers with the order compiled in: Gemini primary,
OpenAI fallback. `routeModelRequest` named both adapters directly, the circuit-breaker map
was a two-key literal, and `AiProviderType` — a Prisma enum used by five columns — had two
values. Adding a provider meant editing the router, and changing which one is preferred
meant a code change and a deploy.

We want Anthropic Claude as the preferred model while keeping Gemini and OpenAI as working
fallbacks, not as dead code. That is a routing-policy change, so it should be configuration,
not a rewrite.

## Decision

### 1. The failover chain is configuration, not code

`AI_PROVIDER_ORDER` is a comma-separated list; the first entry is the primary and the rest
are fallbacks, tried in order. The V1 default is **`GROQ,GEMINI,OPENAI`**.

Groq is primary because it is the only provider live-verified at low latency here
(measured p50 ~208 ms against Gemini's ~1.2 s) and has ~50x the free daily headroom.
Gemini is fallback #1 because it is also live-verified. OpenAI is fallback #2, present and
wired but never live-verified — no credential has been available.

**Anthropic is implemented but withheld from routing** via `AI_DISABLED_PROVIDERS`, which
defaults to `ANTHROPIC`. Its adapter is structurally certified but has never served a live
request, and an unproven provider does not belong in a production chain. Enabling it is an
environment change (`AI_DISABLED_PROVIDERS=`), not a code change.

The chain is a *quota* mechanism as much as an outage mechanism: a provider that is rate
limited or out of quota returns an error like any other failure, so the next tier picks the
request up without intervention. This is verified live in §9.

Parsing is deliberately forgiving: unknown names and duplicates are dropped, and an
unparseable value falls back to the default. A typo in an environment variable must not
take the assistant offline.

Changing the primary — including reverting to Gemini — is now an environment change with no
code edit. `AI_PROVIDER_ORDER=GEMINI,OPENAI` restores the exact pre-ADR behaviour.

### 2. Claude is a first-class provider, not a parallel path

`callAnthropic` sits beside `callGemini` and `callOpenAi`, returns the same
`AiProviderResponse`, and is reached only through the router's `PROVIDER_CALLS` map. It
therefore inherits — rather than reimplements — the circuit breaker, the metrics, the cost
model, the audit trail, and the timeout budget.

It uses plain `fetch` against the Messages API, matching the OpenAI adapter. No SDK was
added. Two shape differences are absorbed inside the adapter: the system prompt is a
top-level `system` field, and `max_tokens` is required. Multi-block responses are
concatenated so a segmented answer is never silently truncated.

### 3. Retry is decided by failure taxonomy, not by position in the chain

Every adapter normalises its native failure into a closed set of codes
(`PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`,
`PROVIDER_AUTH_FAILED`, `PROVIDER_BAD_REQUEST`, `PROVIDER_UNAVAILABLE`, `PROVIDER_5XX`,
`PROVIDER_NETWORK_ERROR`, `PROVIDER_INVALID_RESPONSE`, `PROVIDER_UNKNOWN_ERROR`). The
router reads the code, never the provider.

Only transient codes are retried in place, and only once. An auth failure or malformed
request will fail identically on a second attempt, so retrying merely doubles latency —
those move straight to the next provider. A 429 is different again: it is not a fault but
an instruction to wait, so it parks the provider (§6) instead of being retried.

Worst case per provider is therefore 2 upstream calls, and a three-provider outage costs 6,
bounded by the shared deadline (§20) regardless. Asserted by metric deltas (C20–C24), not
by reading the code.

### 3a. Quota-aware cooldown

A provider that returns 429 is parked until its own `Retry-After` (or vendor reset hint)
expires. Rate limiting and quota exhaustion get different defaults — 60 s versus 15 min —
because a per-minute limit recovers on its own while a daily quota does not, and re-probing
an exhausted daily quota every minute simply wastes attempts. Both are bounded by a ceiling
so a provider can never park itself indefinitely.

Cooldown is tracked **separately from the circuit breaker**. The breaker reacts to faults;
a 429 is not a fault. Conflating them would either trip the breaker on a healthy provider
or discard an explicit Retry-After.

### 4. `fallbackUsed` means a provider actually failed over

Previously, `fallbackUsed = true` was returned whenever OpenAI answered — including when
Gemini was merely unconfigured and never called. Now the flag reflects reality: the first
provider *attempted* is the primary, and `fallbackUsed` is true only if an earlier provider
was tried and failed. `homigo_ai_fallback_total{from,to}` follows the same rule.

**This is a semantic change.** A deployment configured with only OpenAI now reports
`fallbackUsed = false` where it previously reported `true`.

### 5. The enum change is additive and non-destructive

`ANTHROPIC` was appended to the `AiProviderType` Postgres enum via a raw
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` migration. No column was altered and no row was
rewritten; `GEMINI` and `OPENAI` keep their identity and ordinal position, so historical
`ai_gateway_requests` rows are untouched (verified: 1,625 `OPENAI` rows intact before and
after).

`prisma db push` was **not** used — this repo has a recorded incident where `db push`
dropped columns it considered unmanaged. `ALTER TYPE ... ADD VALUE` also cannot run inside
a transaction block, which is why the migration contains nothing else.

### 6. Gemini's transport follows the credential, not the config

`GEMINI_API_KEY` and Vertex are two different services. The adapter previously always went
to Vertex (`aiplatform.googleapis.com`) using application-default credentials and never
read the key at all — so a perfectly valid Gemini API key made `isGeminiConfigured()`
return `true` while every call failed with `PERMISSION_DENIED`, and the router burned two
attempts on a provider that could not work.

`callGemini` now selects the transport from what is actually available: a key routes to the
Gemini Developer API (`generativelanguage.googleapis.com`), and without one it falls back to
the Vertex/ADC path unchanged. Both share the same request builder and response mapper, so
the two transports cannot drift apart.

Model ids are **not** portable between them. Vertex uses publisher ids such as
`gemini-2.0-flash`; the Developer API expects `gemini-flash-latest` or a `gemini-3.x-*` id,
and rejects the Vertex ids as unavailable. `AI_GEMINI_MODEL` must match the transport.

### 7. An empty completion is a failure, not an answer

Reasoning models spend part of the output budget on internal thinking and can return HTTP
200 with zero text parts and `finishReason: MAX_TOKENS`. Measured on `gemini-flash-latest`:
~118 thinking tokens before any visible text, so a 16-token budget yields an empty string
and several shipped templates budget only 512.

All three adapters now raise on a blank completion instead of returning it. The router
treats that as a provider failure and moves to the next provider, so a blank string can
never be delivered as a model answer. The unreferenced health probes were also raised from
8 to 256 output tokens, since 8 would report a healthy provider as unhealthy.

### 7a. One shared circuit breaker, not a second implementation

The router previously carried its own inline breaker. The repository already had
`lib/circuit-breaker.ts` — with bounded HALF_OPEN probes, a state gauge and a trip counter —
and the inline copy had none of that: `halfOpenMax` was configured but never read, so on
reset every concurrent request probed a dead provider at once.

Providers now use the shared registry breaker (`ai_provider_<name>`). The duplicate is
gone, and `circuit_breaker_state` / `circuit_breaker_trips_total` now cover AI providers
like every other external dependency.

### 8. Groq shares OpenAI's implementation, not a copy of it

Groq exposes the same `/chat/completions` contract as OpenAI, so both run through one
`callOpenAiCompatible` helper parameterised by provider identity, endpoint and credential.
Two adapters that must stay byte-compatible are one adapter with two configurations.

Groq's role in the default chain is the tier that absorbs traffic when an earlier provider
is exhausted — it is materially faster (measured ~250 ms vs Gemini's ~2.2 s) and has far
more free headroom (§9).

### 9. One shared deadline, charged by every attempt

`TOTAL_AI_DEADLINE_MS` (default 30 s) bounds the whole request. Each attempt receives only
what remains, and the adapter's abort timer is the *lesser* of its own ceiling and that
remainder.

Checking the deadline only between attempts is not enough: a single adapter would still
block for its full 20 s timeout even when 1 s of budget was left. Measured before the fix,
a 6 s budget produced a 20 s request; after, it is honoured.

### 10. Health is a state machine, not a boolean

Each provider reports one of `AVAILABLE`, `DEGRADED`, `RATE_LIMITED`, `QUOTA_EXHAUSTED`,
`CIRCUIT_OPEN`, `DISABLED`, `MISCONFIGURED`. `GET /api/ai/health` exposes the whole chain
with priority, model, circuit state and remaining cooldown.

The endpoint and the router read the same registry, so they cannot disagree about which
providers are usable. It reports configuration *status* only — no key, prefix, length or
fingerprint. `status` is `ok` only when the *preferred* provider can serve; if merely a
fallback can, the gateway answers but reports `degraded`.

## Consequences

**Good**

- The preferred model is an environment variable. Provider migration no longer needs a deploy.
- Gemini and OpenAI remain fully wired — adapters, env vars, pricing, metrics, health, and
  the ability to be primary. Nothing was removed.
- Adding a provider is an adapter plus two map entries, with the router untouched — Groq
  was added exactly this way after Claude, with no router change at all.
- Quota exhaustion on one provider degrades to the next tier instead of to a canned answer.
- Metric series stay bounded and are pre-seeded at zero at boot, so dashboards read 0 rather
  than NO-DATA before the first request.

**Costs and risks**

- Claude's per-token price is roughly 20× Gemini's in the metering table. Cost per request
  rises materially; `homigo_ai_cost` and the daily gauge should be watched after enabling.
- Pricing constants are hand-maintained and approximate. They are for metering only and are
  never a billing source of truth.
- Worst-case failure latency grows with chain length: a full three-provider outage costs the
  caller the sum of four attempt timeouts before the deterministic fallback answers.
- The `fallbackUsed` semantic change (§4) will move dashboard numbers on any single-provider
  deployment.

**Explicitly unchanged**

- ETA ML inference stays **off**; Google Maps remains the customer-facing ETA source.
- The gateway remains the single logical entry point; no route calls a provider directly.
- Degraded mode still labels itself (`mode = deterministic_fallback`) and never presents a
  dry-run fixture as a model answer. The guard is now provider-agnostic
  (`isAnyProviderConfigured()`), so a future provider cannot silently reopen that path.

## Implementation index

| Concern | Location |
| --- | --- |
| Groq adapter (shared OpenAI-compatible helper) | `apps/backend/src/ai/providers/model-providers.ts` |
| Chain order, per-provider config, presence checks | `apps/backend/src/ai/config.ts` |
| Claude adapter | `apps/backend/src/ai/providers/model-providers.ts` |
| Ordered failover, bounded retry, circuit breaker | `apps/backend/src/ai/router/model-router.ts` |
| Cost model | `apps/backend/src/ai/cost/ai-cost.service.ts` |
| Health surface | `apps/backend/src/ai/gateway/ai-gateway.ts` |
| Metric seeding | `apps/backend/src/lib/ai-metrics.ts` |
| Degraded-mode guard | `apps/backend/src/routes/ai.ts` |
| Enum migration | `apps/backend/prisma/migrations/20260810120000_ai_provider_anthropic/` |
| Configuration reference | `apps/backend/.env.example` |
