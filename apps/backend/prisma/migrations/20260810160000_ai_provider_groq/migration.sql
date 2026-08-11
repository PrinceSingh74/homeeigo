-- Phase 3 — register Groq as a fourth AI provider.
--
-- Same shape as the Anthropic migration: purely additive, no column altered, no row
-- rewritten, existing labels keep their ordinal position. `ALTER TYPE ... ADD VALUE`
-- cannot run inside a transaction block, which is why this file contains nothing else.
ALTER TYPE "AiProviderType" ADD VALUE IF NOT EXISTS 'GROQ';
