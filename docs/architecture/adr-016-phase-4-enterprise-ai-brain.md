# ADR-016: Phase 4 Enterprise AI Brain

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-07 |
| **Owner** | Platform Intelligence |
| **Review Date** | 2027-02-07 |

## Context

Phase 3 delivered the Enterprise AI Gateway — model routing, security, cost tracking, and basic context. Phase 4 transforms this into an enterprise reasoning system with dynamic context engineering, persistent memory, and prompt intelligence.

## Problem

- Context was static (booking/partner/customer lookups only)
- No persistent memory beyond chat history
- Prompts were templates without versioning, approval, or A/B
- No unified activity timeline for AI operations
- No admin visibility into context/memory/prompt state

## Decision

Build the **Enterprise AI Brain** as a layered extension of Phase 3:

```
AI Gateway (Phase 3)
    ↓
Enterprise Context Builder
    ↓
Memory Engine
    ↓
Prompt Intelligence Engine
    ↓
Model Router (unchanged)
```

### Key components

1. **Enterprise Context Builder** — Identity, role, permissions, tenant, business objects, memory, conversation recall
2. **Memory Engine** — 10 memory types with TTL, priority, importance, versioning
3. **Conversation Memory** — Extend `AiConversation`/`AiMessage` with summaries, pinned facts, entities, intents
4. **Prompt Registry** — Centralized registry with versioning, approval, rollback, experiments
5. **Prompt Intelligence** — Variable resolution, context injection, compression, token budget
6. **Activity Timeline** — Full audit of who/what/when/context/prompt/model/tokens/cost

### Reuse (no duplication)

- Phase 0: Outbox, retry, DLQ, metrics, tracing, RBAC, audit
- Phase 1: Feature store, analytics
- Phase 2: ETA labels, travel history
- Phase 3: AI Gateway, model router, security, rate limiter, cost tracking

### Out of scope

- AI Agents, workflow automation, autonomous decisions
- Vision AI, Voice AI, fine-tuning, multi-agent systems

## Alternatives Considered

1. **Replace Phase 3 gateway** — Rejected; breaks backward compatibility
2. **External vector DB for memory** — Deferred to Phase 5 (RAG)
3. **LangChain/LlamaIndex** — Rejected; adds dependency, less control

## Consequences

- Every gateway request builds enterprise context when `AI_BRAIN_ENABLED=true`
- New database tables: `ai_memory`, `ai_prompt_registry`, `ai_prompt_versions`, `ai_context_snapshots`, `ai_activity_timeline`, `ai_context_cache`
- Admin console at `/ai-brain` with 5 sub-pages
- 12 new Prometheus metrics + Grafana dashboard

## Evidence

- Certification: `docs/final-certification/PHASE-4-CERTIFICATION-REPORT.md`
- API: `docs/api/PHASE-4-AI-BRAIN-API.md`
- Security: `docs/security/PHASE-4-AI-BRAIN-SECURITY-REVIEW.md`
