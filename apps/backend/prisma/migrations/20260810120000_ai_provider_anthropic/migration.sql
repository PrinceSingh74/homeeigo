-- Phase 3 — register Anthropic as a first-class AI provider.
--
-- Purely additive: a new value on an existing enum. No column is altered, no row is
-- rewritten, and GEMINI/OPENAI keep their identity and ordinal position, so every
-- existing ai_gateway_requests / ai_gateway_usage / ai_gateway_cost row is untouched.
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on PostgreSQL, which
-- is why this migration contains nothing else. IF NOT EXISTS makes it idempotent across
-- environments that were patched manually before this file landed.
ALTER TYPE "AiProviderType" ADD VALUE IF NOT EXISTS 'ANTHROPIC';
