-- Phase 5 (P5-D1) — consumption audit columns for one-time approvals.
--
-- Deliberately a separate migration from 20260811160000, which adds the CONSUMED enum value.
-- PostgreSQL will not let a newly added enum value be used in the transaction that adds it,
-- and Prisma runs each migration in its own transaction. Splitting by directory — not by an
-- extra file inside one directory — is what actually produces two transactions: the migration
-- engine executes only `migration.sql` from each directory and ignores every other file.
--
-- Additive and idempotent. Existing rows keep their status; the columns are nullable, so an
-- approval that was never consumed reads as such rather than as unknown.
ALTER TABLE "ai_tool_approvals" ADD COLUMN IF NOT EXISTS "consumed_at" TIMESTAMP(3);
ALTER TABLE "ai_tool_approvals" ADD COLUMN IF NOT EXISTS "consumed_by" TEXT;
ALTER TABLE "ai_tool_approvals" ADD COLUMN IF NOT EXISTS "consumed_execution_id" TEXT;
