-- Phase 6D — shadow mode. Additive only: one enum, two defaulted columns, one new table.
-- Every existing definition and instance keeps behaving exactly as before, because LIVE is the
-- default and nothing already in the tables is rewritten.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkflowExecutionMode') THEN
    CREATE TYPE "WorkflowExecutionMode" AS ENUM ('LIVE', 'SHADOW');
  END IF;
END $$;

ALTER TABLE "workflow_definitions"
  ADD COLUMN IF NOT EXISTS "execution_mode" "WorkflowExecutionMode" NOT NULL DEFAULT 'LIVE';

-- Pinned at creation. A definition later re-published as LIVE must not turn a rehearsal that is
-- already running into a real one, which is the same reasoning that pins workflow_version.
ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "execution_mode" "WorkflowExecutionMode" NOT NULL DEFAULT 'LIVE';

CREATE TABLE IF NOT EXISTS "automation_shadow_executions" (
  "id"                   TEXT                    NOT NULL,
  "shadow_execution_id"  TEXT                    NOT NULL,
  "shadow_identity"      TEXT                    NOT NULL,
  "workflow_id"          TEXT                    NOT NULL,
  "workflow_version"     INTEGER                 NOT NULL,
  "workflow_instance_id" TEXT,
  "execution_mode"       "WorkflowExecutionMode" NOT NULL DEFAULT 'SHADOW',
  "trigger_event_id"     TEXT,
  "subject_type"         TEXT                    NOT NULL,
  "subject_id"           TEXT                    NOT NULL,
  "recipient_type"       TEXT,
  "recipient_id"         TEXT,
  "notification_type"    TEXT,
  "category"             "NotificationCategory",
  "intended_channel"     "NotificationChannel",
  "intended_fallback"    TEXT[]                  NOT NULL DEFAULT ARRAY[]::TEXT[],
  "condition_result"     TEXT,
  "governance_result"    TEXT,
  "outcome"              TEXT                    NOT NULL,
  "reason_code"          TEXT                    NOT NULL,
  "reason_text"          TEXT,
  "would_have_sent"      BOOLEAN                 NOT NULL DEFAULT false,
  "would_have_deferred"  BOOLEAN                 NOT NULL DEFAULT false,
  "would_have_suppressed" BOOLEAN                NOT NULL DEFAULT false,
  "would_have_blocked"   BOOLEAN                 NOT NULL DEFAULT false,
  "deferred_until"       TIMESTAMP(3),
  "trace_id"             TEXT,
  "correlation_id"       TEXT,
  "created_at"           TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_shadow_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "automation_shadow_executions_execution_id_key"
  ON "automation_shadow_executions" ("shadow_execution_id");

-- "What would this workflow have done lately" — the question the table exists for.
CREATE INDEX IF NOT EXISTS "automation_shadow_executions_workflow_idx"
  ON "automation_shadow_executions" ("workflow_id", "created_at");

CREATE INDEX IF NOT EXISTS "automation_shadow_executions_instance_idx"
  ON "automation_shadow_executions" ("workflow_instance_id");

-- "How much would have been suppressed / deferred / sent."
CREATE INDEX IF NOT EXISTS "automation_shadow_executions_outcome_idx"
  ON "automation_shadow_executions" ("outcome", "created_at");

-- "What would this booking's automation have done" — the per-subject rehearsal view.
CREATE INDEX IF NOT EXISTS "automation_shadow_executions_subject_idx"
  ON "automation_shadow_executions" ("subject_type", "subject_id", "created_at");
