# Phase 5 AI Tools — Recovery Runbook

## Tool Layer Unavailable

**Symptoms:** `503 TOOLS_DISABLED`, health shows `enabled: false`

**Recovery:**
1. Set `AI_TOOLS_ENABLED=true` (or remove env override)
2. Restart backend
3. Verify `/api/ai/tools/health`

## Database Tables Missing

**Symptoms:** Certification fails on Database module, 500 on tool routes

**Recovery:**
```bash
cd apps/backend
bunx prisma migrate deploy
bunx prisma generate
```

## Approval Queue Stuck

**Symptoms:** `homigo_ai_tool_pending_approvals` gauge growing, items not expiring

**Recovery:**
1. Verify leader lock maintenance running: check logs for `ai_brain_maintenance`
2. Manual expiry: call `expireStaleApprovals()` via certification script context
3. Cancel orphaned approvals via API

## High Failure Rate

**Symptoms:** `AiToolFailureSpike` alert

**Recovery:**
1. Query denied/failed history: `GET /api/ai/tools/history?status=FAILED`
2. Identify failing `serviceMapping` — fix underlying service
3. Check circuit breaker state: `GET /api/ai/tools/metrics` → `circuits`
4. Wait for CB reset or restart

## Policy Mass Denial

**Symptoms:** Spike in `homigo_ai_tool_denied`

**Recovery:**
1. Review policy logs: `GET /api/ai/tools/policies`
2. Check `MAINTENANCE_MODE`, `AI_TOOL_BUSINESS_HOURS_ONLY`, `AI_TOOL_FRAUD_BLOCK`
3. Verify actor roles match tool `requiredRole`

## Rollback

To disable Phase 5 without removing code:

```bash
AI_TOOLS_ENABLED=false
```

Phases 3–4 continue unaffected. No data loss — execution history retained in `ai_tool_executions`.
