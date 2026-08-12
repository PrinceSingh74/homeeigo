# Phase 3 Audit — Homigo AI Core

**Score: 78%** · **HEAD:** `b582ead` · Audit-only

## Summary

The gateway and model router are well-built and roadmap-faithful — including a circuit breaker the roadmap only listed as optional. The score is dragged down by one hard defect: **usage tracking is dead**, with cost tracking nearly so, against 1,626 real requests.

## Runtime Evidence

```
gateway requests: 1626
gateway audit:    1627
gateway usage:       0    <-- BROKEN
gateway cost:        1    <-- effectively dead
```

## Requirement Detail

**Single entry point — IMPLEMENTED.** `ai/gateway/ai-gateway.ts` behind `routes/ai-gateway.routes.ts`, registered at `index.ts:209`. Customer, partner, and admin all traverse it.

**Auth / RBAC — IMPLEMENTED.** `ai/security/authorization.ts`.

**Rate limiting — IMPLEMENTED.** `ai/rate-limit/ai-rate-limit.ts`.

**Request validation — IMPLEMENTED.** `ai/security/input-validator.ts`.

**Output validation — IMPLEMENTED.** `ai/security/output-validator.ts` — the roadmap only asked for input validation, so this exceeds requirement.

**Prompt-injection protection — IMPLEMENTED.** `ai/security/prompt-security.ts`.

**Timeout — IMPLEMENTED.** Abort/timeout classification at `model-router.ts:54`.

**Retry — IMPLEMENTED.** Retry-once against the primary before failing over (`:75-79`).

**Circuit breaker — IMPLEMENTED.** Failure-threshold tripping and timed reset (`:18`, `:31`), with an explicit `open` state. Not strictly required by the roadmap; a genuine plus.

**Model Router: Gemini primary → OpenAI fallback — IMPLEMENTED.** Documented at `model-router.ts:64` and matching the implementation. `RouterResult` carries a `fallbackUsed` flag so downstream can observe failover.

**No unnecessary 5-model complexity — IMPLEMENTED.** Exactly two providers, as the roadmap directed.

**Provider abstraction — IMPLEMENTED.** `ai/providers/model-providers.ts`.

**Audit trail — IMPLEMENTED.** `AiGatewayAudit`, 1,627 rows — one per request plus one, so coverage is complete.

**Usage tracking — BROKEN.** `AiGatewayUsage` exists in schema (`schema.prisma:3949`) and holds **0 rows** after 1,626 requests. A repo-wide search for `aiGatewayUsage.(create|upsert|createMany)` returns **zero matches** — nothing anywhere writes this table. The roadmap lists "Usage" as a mandatory gateway capability.

**Cost tracking — PARTIAL.** `ai/cost/ai-cost.service.ts` exists and `AiGatewayCost` holds 1 row against 1,626 requests. Effectively non-functional.

**Tracing — NOT_VERIFIED.** Trace IDs exist in the event layer; gateway-level tracing was not evidenced.

**Prompt templates — IMPLEMENTED.** `ai/templates/prompt-templates.ts` + `AiPromptTemplate`.

**Metrics — IMPLEMENTED.** `lib/ai-metrics.ts`.

**Grafana — PARTIAL.** `homigo-ai-core.json` authored but not mounted by the running stack.

**Alerts — PARTIAL.** Only 1 distinct `ai_gateway` metric referenced in alert rules, versus 6 for `ai_tool`. Gateway incidents are thinly covered.

## Assessment

Control-plane engineering (routing, failover, breaker, injection defense) is strong. The accounting plane is missing. For an AI platform where spend is a first-order operational risk, running 1,626 requests with no usage record is a material gap — you cannot answer "who used how much" or enforce a quota today.

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P1-1 | Usage tracking never written; cost near-dead | P1 |
| P1-3 | ai-core dashboard not deployed | P1 |
| P2-5 | Thin gateway alert coverage | P2 |
