# Phase 4 AI Brain — Recovery Runbook

## Memory Engine Failure

**Symptoms:** `homigo_memory_writes` flat, memory API 500 errors

1. Check PostgreSQL connectivity: `SELECT count(*) FROM ai_memory;`
2. Verify migration applied: `20260807180000_phase4_ai_brain`
3. Run memory expiry: memories auto-archive on TTL
4. If corrupted: `UPDATE ai_memory SET is_archived = true WHERE expires_at < NOW();`

## Prompt Registry Inconsistency

**Symptoms:** Alert `AiBrainPromptRegistryInconsistency`, no active prompt versions

1. Re-seed registry:
   ```bash
   bun -e "import { seedPromptRegistry } from './src/ai-brain'; await seedPromptRegistry();"
   ```
2. Approve pending versions via admin API
3. Verify: `SELECT count(*) FROM ai_prompt_versions WHERE is_active = true;`

## Large Context / Token Budget Exceeded

**Symptoms:** Alert `AiBrainLargeContext`, requests failing with token budget error

1. Set `AI_BRAIN_ENABLED=false` temporarily to use Phase 3 minimal context
2. Purge context cache: POST `/api/ai/context/cache/purge`
3. Review context collectors for over-fetching
4. Lower `CONTEXT_TOKEN_BUDGET.default` if needed

## Context Cache Corruption

**Symptoms:** Stale/wrong context in responses

1. Purge all cache for actor:
   ```sql
   DELETE FROM ai_context_cache WHERE actor_id = '<actor_id>';
   ```
2. Force rebuild: POST `/api/ai/context/rebuild`

## Full AI Brain Disable

Set environment:
```
AI_BRAIN_ENABLED=false
AI_GATEWAY_ENABLED=true
```

Gateway continues with Phase 3 context engine only. No data loss.

## Database Rollback

Phase 4 migration is additive. To rollback:
1. Set `AI_BRAIN_ENABLED=false`
2. Drop Phase 4 tables only if necessary (loses memory/prompt registry data)
3. Phase 3 gateway continues unaffected
