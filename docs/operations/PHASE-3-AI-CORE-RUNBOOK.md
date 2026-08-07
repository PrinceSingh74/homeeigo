# Phase 3 Enterprise AI Core — Operations Runbook

**Version:** 1.0  
**Date:** 2026-08-07  
**Owner:** Platform / SRE

## Overview

The Enterprise AI Core is HOMIGO's governed LLM gateway. All AI modules must route through `/apps/backend/src/ai/`. Direct Gemini or OpenAI calls from application code are forbidden for new development.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_GATEWAY_ENABLED` | No | `true` | Master switch |
| `AI_GATEWAY_DRY_RUN` | No | `false` | Mock responses (certification/dev) |
| `GCP_PROJECT_ID` | For Gemini | `homigo-497619` | Vertex AI project |
| `VERTEX_LOCATION` | No | `us-central1` | Gemini region |
| `AI_GEMINI_MODEL` | No | `gemini-2.0-flash` | Primary model |
| `OPENAI_API_KEY` | For fallback | — | OpenAI API key |
| `AI_OPENAI_MODEL` | No | `gpt-4o-mini` | Fallback model |

## Health Checks

```bash
curl http://localhost:3000/api/ai/health
```

Expected response when healthy:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "gateway": true,
    "gemini": { "configured": true, "circuit": "closed" },
    "openai": { "configured": true, "circuit": "closed" }
  }
}
```

## Incident Response

### Gemini Unavailable (Alert: `AiGeminiUnavailable`)

1. Check Vertex AI status and GCP credentials
2. Verify circuit breaker state via health endpoint
3. Gateway auto-falls back to OpenAI — confirm fallback metrics: `homigo_ai_fallback_total`
4. If both providers down, set `AI_GATEWAY_DRY_RUN=true` temporarily for non-critical paths

### Fallback Spike (Alert: `AiFallbackSpike`)

1. Investigate Gemini errors in logs (search `[vertex]`)
2. Check `homigo_ai_timeout_total{provider="GEMINI"}`
3. Reset circuit breaker by restarting backend (in-memory state)

### High Latency (Alert: `AiLatencyHigh`)

1. Check Grafana dashboard `homigo-ai-core` → Latency p95 panel
2. Review prompt sizes — large context increases latency
3. Verify provider regional endpoints

### Prompt Attack (Alert: `AiPromptAttackSpike`)

1. Review `homigo_ai_prompt_blocked` by category
2. Identify source IPs from `ai_gateway_audit` table
3. Rate limits auto-engage; escalate to security if sustained

### High Cost (Alert: `AiHighCost`)

1. Query `GET /api/ai/cost?days=1` (admin auth required)
2. Break down by role and provider
3. Review unusual actor patterns in `ai_gateway_requests`

## Database Maintenance

```sql
-- Daily cost summary
SELECT date, provider, actor_role, total_cost_usd, request_count
FROM ai_gateway_cost
ORDER BY date DESC LIMIT 7;

-- Recent blocked requests
SELECT request_id, actor_role, error_code, created_at
FROM ai_gateway_requests
WHERE status = 'BLOCKED'
ORDER BY created_at DESC LIMIT 20;
```

## Certification

```bash
cd apps/backend
AI_GATEWAY_DRY_RUN=true bun run scripts/phase-3-certification.ts
```

## Recovery

See [PHASE-3-RECOVERY-RUNBOOK.md](./PHASE-3-RECOVERY-RUNBOOK.md).
