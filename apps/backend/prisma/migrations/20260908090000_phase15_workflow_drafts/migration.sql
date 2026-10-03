-- Phase 15 — AI-assisted workflow drafting. Additive; touches no existing table.
CREATE TYPE "ai_workflow_draft_status" AS ENUM ('DRAFT', 'REJECTED', 'APPROVED', 'IMPLEMENTED');
CREATE TYPE "ai_workflow_risk_class"   AS ENUM ('INERT', 'NOTIFYING', 'ESCALATING', 'REJECTED_UNSAFE');

CREATE TABLE "ai_workflow_drafts" (
  "id"             TEXT NOT NULL,
  "proposed_id"    TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "intent"         TEXT NOT NULL,
  "steps"          JSONB NOT NULL,
  "trigger"        TEXT NOT NULL,
  "status"         "ai_workflow_draft_status" NOT NULL DEFAULT 'DRAFT',
  "risk_class"     "ai_workflow_risk_class" NOT NULL,
  "validation"     JSONB NOT NULL,
  "model_provider" TEXT,
  "model_name"     TEXT,
  "prompt_version" INTEGER,
  "prompt_hash"    TEXT NOT NULL,
  "created_by"     TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by"    TEXT,
  "reviewed_at"    TIMESTAMP(3),
  "review_note"    TEXT,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_workflow_drafts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_workflow_drafts_status_created_at_idx" ON "ai_workflow_drafts" ("status", "created_at");
CREATE INDEX "ai_workflow_drafts_proposed_id_idx" ON "ai_workflow_drafts" ("proposed_id");
