# Phase 4 Enterprise AI Brain — Operations Runbook

## Overview

The AI Brain layer extends Phase 3 gateway with context engineering, memory, and prompt intelligence. It runs in-process with the backend — no separate service.

## Health Checks

```bash
curl -s http://localhost:3000/api/ai/health | jq
```

Verify `gateway: true` and provider circuits are `closed`.

## Key Metrics

| Metric | Meaning | Alert Threshold |
|--------|---------|-----------------|
| `homigo_context_build_total` | Context builds per role | N/A (counter) |
| `homigo_context_latency` | Context build latency | p95 > 5s |
| `homigo_memory_reads/writes` | Memory operations | Abnormal archive spike |
| `homigo_prompt_blocked_total` | Blocked prompts | > 15 in 15m |
| `homigo_context_size` | Context payload size | p95 > 50KB |
| `homigo_ai_brain_memory_total` | Active memory records | Gauge |
| `homigo_ai_brain_prompts_active` | Active prompt versions | Should be > 0 |

## Grafana Dashboard

Import `monitoring/grafana/dashboards/homigo-ai-brain.json` — Dashboard 19.

## Common Operations

### Purge expired context cache

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/ai/context/cache/purge
```

### Rollback prompt version

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"promptId":"customer.support.v1","version":1}' \
  http://localhost:3000/api/ai/prompt-versions/rollback
```

### Disable AI Brain (emergency)

Set `AI_BRAIN_ENABLED=false` and restart backend. Gateway falls back to Phase 3 basic context.

## Memory Cleanup

Stale memories are archived automatically when `expiresAt` passes. Manual cleanup:

```sql
UPDATE ai_memory SET is_archived = true WHERE expires_at < NOW() AND is_archived = false;
```

## Incident Response

1. **High prompt block rate** — Check `homigo_prompt_blocked_total` labels; review attack patterns in timeline
2. **Large context** — Check context snapshots; verify business object collectors aren't over-fetching
3. **Memory failures** — Check PostgreSQL connectivity; verify migration applied
4. **Prompt registry inconsistency** — Re-run seed: `seedPromptRegistry()` on boot or manually approve versions

## Certification

```bash
cd apps/backend
AI_GATEWAY_DRY_RUN=true bun run scripts/phase-4-certification.ts
```

Expected: `PHASE 4 CERTIFIED`
