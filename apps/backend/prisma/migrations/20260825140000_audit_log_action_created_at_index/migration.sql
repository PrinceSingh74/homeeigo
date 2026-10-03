-- P2-2: composite index for the audit-log search path.
--
-- Prisma Migrate applies each migration inside a transaction. PostgreSQL rejects
-- CREATE INDEX CONCURRENTLY in a transaction (SQLSTATE 25001), which is why the
-- original CONCURRENTLY form failed with finished_at NULL and blocked later deploys.
-- Equivalent Prisma-safe form: CREATE/DROP INDEX IF NOT EXISTS/EXISTS (brief SHARE
-- lock during build; IF NOT EXISTS is idempotent if already created out-of-band).
CREATE INDEX IF NOT EXISTS "enterprise_audit_logs_action_created_at_idx"
  ON "enterprise_audit_logs" ("action", "created_at" DESC);

DROP INDEX IF EXISTS "enterprise_audit_logs_action_idx";
