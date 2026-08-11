-- Phase 4 — record which prompt version served each request.
--
-- Additive and nullable: existing rows keep their meaning (version unknown), and no
-- backfill is implied. The activity timeline already carried promptVersion; putting it on
-- the request audit makes "which prompt answered this request" answerable from one table.
ALTER TABLE "ai_gateway_requests" ADD COLUMN IF NOT EXISTS "prompt_version" INTEGER;
