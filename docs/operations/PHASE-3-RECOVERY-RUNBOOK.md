# Phase 3 Enterprise AI Core — Recovery Runbook

**Version:** 1.0  
**Date:** 2026-08-07

## Scenario 1: Complete AI Gateway Failure

**Symptoms:** All `/api/ai/*` gateway endpoints return 502/504.

**Recovery:**
1. Check `/api/ai/health` — if `status: down`, both providers unavailable
2. Set `AI_GATEWAY_DRY_RUN=true` to restore degraded service with mock responses
3. Fix provider credentials (GCP ADC or `OPENAI_API_KEY`)
4. Restart backend to reset circuit breakers
5. Run certification script to verify recovery

## Scenario 2: Database Tables Missing

**Symptoms:** 500 errors, Prisma "Unknown model" in logs.

**Recovery:**
```bash
cd apps/backend
bunx prisma migrate deploy
bunx prisma generate
# Restart backend
```

## Scenario 3: Circuit Breaker Stuck Open

**Symptoms:** Health shows `circuit: open` for Gemini despite provider being healthy.

**Recovery:**
1. Restart backend (circuit state is in-memory)
2. Or call `resetCircuits()` via admin maintenance script
3. Verify with health endpoint

## Scenario 4: Cost Runaway

**Symptoms:** `AiHighCost` alert firing.

**Recovery:**
1. Set `AI_GATEWAY_ENABLED=false` to halt all LLM requests
2. Audit `ai_gateway_requests` for anomalous actors
3. Tighten rate limits in `ai/rate-limit/ai-rate-limit.ts` if needed
4. Re-enable gateway after investigation

## Scenario 5: Prompt Injection Campaign

**Symptoms:** `AiPromptAttackSpike` alert, high `homigo_ai_prompt_blocked`.

**Recovery:**
1. Gateway auto-blocks — no provider calls made for blocked prompts
2. Review audit table for attack patterns
3. Block source IPs at WAF/load balancer if external
4. No data exfiltration risk — prompts are hashed, secrets redacted

## Regression Verification

After any recovery:

```bash
AI_GATEWAY_DRY_RUN=true bun run scripts/phase-3-certification.ts
```

Verify Phase 0–2 certified flows unaffected:
```bash
bun run scripts/phase-2-certification.ts
```
