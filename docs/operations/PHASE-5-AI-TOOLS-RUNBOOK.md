# Phase 5 AI Tools — Operations Runbook

## Overview

The Enterprise Tool Layer (`apps/backend/src/ai-tools/`) governs all AI-initiated actions against existing Homigo services.

## Health Checks

```bash
curl http://localhost:3000/api/ai/tools/health
```

Expected: `{ "enabled": true, "toolCounts": { "READ": 30+, "WRITE": 13, "HIGH_RISK": 14 } }`

## Enable / Disable

```bash
# Disable all tool execution (gateway still works)
AI_TOOLS_ENABLED=false

# Block write tools during maintenance
MAINTENANCE_MODE=true
```

## Approval Queue Management

1. Admin Panel → AI HQ → Enterprise Tool Center → Approval Queue
2. API: `GET /api/ai/tools/approvals`
3. Approve: `POST /api/ai/tools/approvals/:id/decide` with `{ "decision": "APPROVED", "reason": "..." }`
4. Reject: `{ "decision": "REJECTED" }`

Stale approvals expire automatically via `maintenance:ai_brain` leader lock sweep.

## Monitoring

| Alert | Action |
|-------|--------|
| AiToolFailureSpike | Check `/api/ai/tools/history?status=FAILED`, inspect service health |
| AiToolApprovalQueueGrowing | Review pending high-risk items in Tool Center |
| AiToolExecutionTimeout | Check downstream service latency, increase tool timeout if needed |
| AiToolUnauthorizedAccess | Review `/api/ai/tools/denied` for policy/RBAC misconfiguration |
| AiToolAbuse | Verify rate limits, check actor IDs in execution history |

Grafana dashboard: **20 — Enterprise AI Tools**

## Certification

```bash
cd apps/backend
bun run --env-file=.env scripts/phase-5-certification.ts
```

## Registry Sync

On boot, `seedToolRegistry()` upserts catalog to `ai_tool_registry`. Manual sync:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/ai/tools/registry
```

## Circuit Breaker Reset

Circuit breakers auto-reset after `AI_TOOL_CB_RESET_MS` (default 60s). Restart backend to clear all breaker state.
