# ADR-017: Phase 5 Enterprise AI Tools & Action Layer

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-07 |
| **Owner** | Platform Intelligence |
| **Review Date** | 2027-02-07 |

## Context

Phases 3–4 delivered the Enterprise AI Gateway and AI Brain — governed LLM access with context, memory, and prompts. Phase 5 adds the **Tool & Action Layer** so AI can invoke existing Homigo services through a centralized, policy-governed execution pipeline.

## Problem

- No tool registry or function-calling layer
- No policy engine for tool authorization beyond template RBAC
- No approval workflow for high-risk financial/compliance actions
- No unified tool execution audit trail
- AI could not safely perform read/write operations on bookings, wallet, support, etc.

## Decision

Build the **Enterprise Tool & Action Layer** as a new module extending Phases 0–4:

```
AI Gateway (Phase 3)
    ↓
AI Brain (Phase 4)
    ↓
Tool Registry (Phase 5)
    ↓
Permission Engine
    ↓
Policy Engine
    ↓
Execution Engine
    ↓
Existing Homigo Services
    ↓
Events · Audit · Metrics
```

### Key components

1. **Tool Registry** — Centralized catalog with 50+ tools (read, write, high-risk definitions)
2. **Policy Engine** — RBAC, ABAC, ownership, maintenance mode, fraud blocks, business hours
3. **Approval Engine** — Human-in-the-loop for high-risk tools (refund, payout, ban, etc.)
4. **Execution Engine** — Validation, rate limit, timeout, retry, circuit breaker, idempotency
5. **Tool Handlers** — Thin adapters calling existing services (no Prisma/SQL in tool layer)
6. **Observability** — 10 Prometheus metrics + Grafana dashboard + alert rules

### Reuse (no duplication)

- Phase 0: Outbox, retry, DLQ, metrics, tracing, audit, leader lock
- Phase 1: Analytics, forecast (via admin read tools)
- Phase 2: ETA labels (via geo read tools)
- Phase 3: AI Gateway RBAC, rate limit patterns, audit hashing
- Phase 4: Activity timeline, brain security redaction

### High-risk rule

**AI MUST NEVER execute high-risk tools directly.** High-risk tools return `REQUIRES_APPROVAL`; execution proceeds only after admin approval with argument hash verification.

### Out of scope

- LLM function-calling loop (orchestrator deferred)
- Direct DB/repository access from tools
- Business logic duplication in tool handlers

## Alternatives Considered

1. **LangChain tools** — Rejected; less control, external dependency
2. **Tools in services/** — Rejected; blurs domain vs governance layers
3. **Auto-execute high-risk with elevated token** — Rejected; violates compliance requirements

## Consequences

- New module: `apps/backend/src/ai-tools/`
- New tables: `ai_tool_registry`, `ai_tool_executions`, `ai_tool_approvals`, `ai_tool_policy_logs`
- API: `/api/ai/tools/*`
- Admin UI: `/ai-brain/tools` Enterprise Tool Center
- 10 new Prometheus metrics + Grafana dashboard `homigo-ai-tools`

## Evidence

- Certification: `docs/final-certification/PHASE-5-CERTIFICATION-REPORT.md`
- API: `docs/api/PHASE-5-AI-TOOLS-API.md`
- Security: `docs/security/PHASE-5-AI-TOOLS-SECURITY-REVIEW.md`
- Runbook: `docs/operations/PHASE-5-AI-TOOLS-RUNBOOK.md`
