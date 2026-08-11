-- Phase 5 (P5-D1) — make an approval a one-time, bound authorization.
--
-- The row already carried tool_id, requested_by and expires_at; consumption simply never
-- read them, and there was no state in which an approval could be marked spent. Both gaps
-- are closed here: a terminal CONSUMED status plus the audit of who spent it and when.
--
-- Additive and backward compatible. Existing rows keep their status; the new columns are
-- nullable, so an approval that was never consumed reads as such rather than as unknown.
ALTER TYPE "AiToolApprovalStatus" ADD VALUE IF NOT EXISTS 'CONSUMED';
