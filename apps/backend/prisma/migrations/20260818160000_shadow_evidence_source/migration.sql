-- Phase 6G-C — tell a rehearsal from a test. Additive only: one enum, one defaulted column.
--
-- OBSERVATION is the default because the failure mode to avoid is deleting real evidence. A row
-- that never said where it came from is kept; only a row that explicitly says TEST can be swept.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShadowEvidenceSource') THEN
    CREATE TYPE "ShadowEvidenceSource" AS ENUM ('TEST', 'OBSERVATION');
  END IF;
END $$;

ALTER TABLE "automation_shadow_executions"
  ADD COLUMN IF NOT EXISTS "source" "ShadowEvidenceSource" NOT NULL DEFAULT 'OBSERVATION';

-- Reporting reads observations by workflow over time; cleanup reads tests. One index serves both.
CREATE INDEX IF NOT EXISTS "automation_shadow_executions_source_idx"
  ON "automation_shadow_executions" ("source", "workflow_id", "created_at");
