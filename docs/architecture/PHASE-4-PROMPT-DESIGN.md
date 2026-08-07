# Phase 4 AI Brain — Prompt Design

## Registry Structure

Each prompt in `ai_prompt_registry` has:
- Unique `promptId` (e.g. `customer.support.v1`)
- Category from 12 approved categories
- Owner and approval status
- One or more versions in `ai_prompt_versions`

## Version Lifecycle

```
DRAFT → PENDING → APPROVED → (active)
                ↘ REJECTED
APPROVED → DEPRECATED (rollback available)
```

## Prompt Composition Pipeline

1. Load active approved version from registry (fallback to Phase 3 template)
2. Resolve `{{variables}}` from context
3. Inject role-specific policy block
4. Inject permission block
5. Compress context to token budget
6. Append hallucination guard with verified entity IDs
7. Isolate system prompt from user prompt (Phase 3 security)

## Token Budget

- Default context budget: 12,000 tokens
- System reserve: 2,000 tokens
- Response reserve: 2,048 tokens
- Max total: 16,000 tokens
- Trimming: sections sorted by priority, lowest dropped first

## Categories

customer, partner, admin, finance, fraud, support, eta, operations, analytics, forecast, internal, system

## A/B Experiments

Versions support `experimentTag` field for future A/B routing. Active version selection currently uses `isActive=true` flag.

## Seeding

Phase 3 built-in templates auto-seed into registry on boot via `seedPromptRegistry()`.
