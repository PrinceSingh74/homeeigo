-- Phase 6A — Automation Workflow Engine.
--
-- Purely additive: three new tables and three new enums. Nothing existing is altered, and in
-- particular `scheduled_jobs` is untouched — workflow steps ride on it as ordinary jobs so they
-- inherit its claim, lease, retry, dead-letter and leader-lock guarantees rather than repeating
-- them.

CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED');

CREATE TYPE "WorkflowInstanceStatus" AS ENUM (
  'PENDING', 'RUNNING', 'WAITING', 'SCHEDULED', 'PAUSED',
  'COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED'
);

CREATE TYPE "WorkflowStepType" AS ENUM (
  'WAIT', 'CONDITION', 'ACTION', 'NOTIFICATION', 'ESCALATION', 'STOP'
);

CREATE TABLE "workflow_definitions" (
  "id"           TEXT NOT NULL,
  "workflow_id"  TEXT NOT NULL,
  "version"      INTEGER NOT NULL,
  "name"         TEXT NOT NULL,
  "status"       "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  "trigger"      TEXT NOT NULL,
  "steps"        JSONB NOT NULL,
  "max_age_ms"   INTEGER NOT NULL,
  "max_steps"    INTEGER NOT NULL,
  "activated_at" TIMESTAMP(3),
  "metadata"     JSONB,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_definitions_workflow_id_version_key"
  ON "workflow_definitions"("workflow_id", "version");
CREATE INDEX "workflow_definitions_workflow_id_status_idx"
  ON "workflow_definitions"("workflow_id", "status");
CREATE INDEX "workflow_definitions_trigger_status_idx"
  ON "workflow_definitions"("trigger", "status");

CREATE TABLE "workflow_instances" (
  "id"               TEXT NOT NULL,
  "workflow_id"      TEXT NOT NULL,
  "workflow_version" INTEGER NOT NULL,
  "subject_type"     TEXT NOT NULL,
  "subject_id"       TEXT NOT NULL,
  "status"           "WorkflowInstanceStatus" NOT NULL DEFAULT 'PENDING',
  "current_step_id"  TEXT,
  "step_index"       INTEGER NOT NULL DEFAULT 0,
  "step_count"       INTEGER NOT NULL DEFAULT 0,
  "next_run_at"      TIMESTAMP(3),
  "trigger_event_id" TEXT,
  "idempotency_key"  TEXT NOT NULL,
  "trace_id"         TEXT,
  "correlation_id"   TEXT,
  "reason_code"      TEXT,
  "failure_reason"   TEXT,
  "metadata"         JSONB,
  "started_at"       TIMESTAMP(3),
  "completed_at"     TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- The duplicate-trigger guard: a second delivery of the same event cannot open a second instance.
CREATE UNIQUE INDEX "workflow_instances_idempotency_key_key"
  ON "workflow_instances"("idempotency_key");
CREATE INDEX "workflow_instances_workflow_id_status_idx"
  ON "workflow_instances"("workflow_id", "status");
CREATE INDEX "workflow_instances_status_next_run_at_idx"
  ON "workflow_instances"("status", "next_run_at");
CREATE INDEX "workflow_instances_subject_type_subject_id_idx"
  ON "workflow_instances"("subject_type", "subject_id");

CREATE TABLE "workflow_step_runs" (
  "id"          TEXT NOT NULL,
  "instance_id" TEXT NOT NULL,
  "step_id"     TEXT NOT NULL,
  "step_index"  INTEGER NOT NULL,
  "step_type"   "WorkflowStepType" NOT NULL,
  "outcome"     TEXT NOT NULL,
  "reason_code" TEXT,
  "reason_text" TEXT,
  "attempt"     INTEGER NOT NULL DEFAULT 1,
  "job_id"      TEXT,
  "duration_ms" INTEGER,
  "metadata"    JSONB,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_step_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_step_runs_instance_id_step_index_idx"
  ON "workflow_step_runs"("instance_id", "step_index");
CREATE INDEX "workflow_step_runs_outcome_created_at_idx"
  ON "workflow_step_runs"("outcome", "created_at");

ALTER TABLE "workflow_step_runs"
  ADD CONSTRAINT "workflow_step_runs_instance_id_fkey"
  FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
