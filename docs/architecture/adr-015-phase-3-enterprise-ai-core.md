# ADR-015: Phase 3 Enterprise AI Core Platform

**Status:** Accepted  
**Date:** 2026-08-07  
**Owner:** Platform / AI Engineering  
**Baseline:** Certified commit `7ff5683` (Phases 0–2)

## Context

HOMIGO requires a single governed AI platform for all future modules (Customer AI, Partner AI, Admin AI, Finance AI, Fraud AI, Support AI, Voice AI, Vision AI, Automation AI). Direct provider calls are forbidden. Phase 3 delivers the Enterprise AI Core — not chatbot UI, RAG, memory, or agents.

## Decision

Implement a centralized **AI Gateway** at `/apps/backend/src/ai/` as the sole entry point for LLM requests.

### Architecture

```
Client → API → RBAC → Rate Limit → Input Validation → Prompt Security
  → Prompt Builder → AI Gateway → Model Router → Gemini (primary)
  → [retry once] → OpenAI (fallback) → Output Validation → Audit → Metrics
```

### Key Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary model | Gemini (Vertex AI) | Existing GCP integration, asia-south1 data residency |
| Fallback model | OpenAI only | Spec constraint; no Claude/DeepSeek/etc. |
| Routing | Primary-then-fallback | No load balancing, no random routing |
| Retry | Phase 0 `computeRetryDelayMs` | Reuse certified retry utility |
| Timeouts | Gemini 20s, OpenAI 20s, Gateway 25s | Spec policy |
| Memory | None | Phase 4 scope |
| RAG / Vector DB | None | Phase 4+ scope |
| Audit storage | Dedicated `ai_gateway_audit` table | Prompt/response hashes only, never secrets |
| Existing `/api/ai/chat` | Unchanged (rule-based) | Preserve Phase 0–2 certified flow |

### Database Tables

- `ai_gateway_requests` — request lifecycle
- `ai_gateway_usage` — aggregated usage
- `ai_gateway_audit` — compliance audit trail
- `ai_gateway_cost` — daily cost rollup
- `ai_prompt_templates` — centralized prompt library

### API Endpoints

| Method | Path | Role |
|--------|------|------|
| POST | `/api/ai/gateway/chat` | Authenticated (role-mapped) |
| POST | `/api/ai/customer` | CUSTOMER |
| POST | `/api/ai/partner` | VENDOR → PARTNER |
| POST | `/api/ai/admin` | ADMIN |
| GET | `/api/ai/usage` | ADMIN |
| GET | `/api/ai/cost` | ADMIN |
| GET | `/api/ai/health` | Public |

## Consequences

### Positive

- Single governance point for all future AI modules
- Consistent security, audit, cost tracking, and observability
- Graceful Gemini → OpenAI fallback with circuit breaker
- Reuses Phase 0 retry, rate limiting, and metrics patterns

### Negative

- Additional latency from validation layers (~5–15ms)
- Requires migration for 5 new tables
- Provider keys must be configured for live inference

### Out of Scope (Phase 4+)

- AI Agents, RAG, Memory, Voice AI, Vision AI, Workflow Automation, Digital Twin

## Traceability

- Certification: `apps/backend/scripts/phase-3-certification.ts`
- Grafana: `monitoring/grafana/dashboards/homigo-ai-core.json`
- Alerts: `monitoring/rules/homigo-alerts.yml` → `homigo_ai_core` group
