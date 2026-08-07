# Phase 4 AI Brain — Operations Runbook

## Overview

The Enterprise AI Brain extends the Phase 3 AI Gateway with context engineering, memory, and prompt intelligence. It activates automatically when `AI_BRAIN_ENABLED=true` (default).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_BRAIN_ENABLED` | `true` | Enable enterprise context + prompt intelligence |
| `AI_CONTEXT_CACHE_TTL` | `300` | Context cache TTL (seconds) |
| `AI_CONTEXT_SNAPSHOT_TTL_HOURS` | `24` | Snapshot retention |
| `AI_MEMORY_CLEANUP_INTERVAL_MS` | `3600000` | Memory expiry sweep interval |
| `AI_PROMPT_COMPRESSION_THRESHOLD` | `0.8` | Trigger compression below this ratio |
| `AI_MEMORY_SEARCH_LIMIT` | `50` | Max memory search results |

## Health Checks

```bash
curl -s http://localhost:3000/api/ai/health | jq
```

Verify:
- `gateway: true`
- Gemini/OpenAI circuit states

## Admin Console

Navigate to `/ai-brain` in admin panel:
- **AI Brain Console** — Overview KPIs
- **Context Explorer** — Context snapshots
- **Memory Explorer** — Memory records
- **Prompt Registry** — Prompt library
- **Activity Timeline** — Full audit trail

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

### Disable AI Brain (fallback to Phase 3 context only)

Set `AI_BRAIN_ENABLED=false` and restart backend.

## Grafana Dashboard

Dashboard UID: `homigo-ai-brain`

Key panels:
- Context builds/sec, latency, size
- Memory reads/writes, cache hit rate
- Prompt tokens, blocked count, compression ratio

## Alerts

| Alert | Severity | Action |
|-------|----------|--------|
| AiBrainMemoryFailure | warning | Check memory engine logs, DB connectivity |
| AiBrainPromptFailure | critical | Review blocked prompts, check injection patterns |
| AiBrainLargeContext | warning | Review context collectors, increase trimming |
| AiBrainPromptRegistryInconsistency | warning | Run `seedPromptRegistry()` or approve versions |

## Recovery

See `PHASE-4-RECOVERY-RUNBOOK.md`
