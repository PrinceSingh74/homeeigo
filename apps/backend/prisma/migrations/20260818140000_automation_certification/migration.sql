-- Phase 6G-B — certification lifecycle. Additive only.
--
-- Every existing definition keeps working untouched: certification_status defaults to DRAFT and
-- risk_class stays NULL, and a NULL risk_class is precisely what marks a definition as legacy and
-- exempt from the new gate.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkflowCertificationStatus') THEN
    CREATE TYPE "WorkflowCertificationStatus" AS ENUM ('DRAFT','SHADOW','CERTIFIED','DISABLED','DEPRECATED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkflowRiskClass') THEN
    CREATE TYPE "WorkflowRiskClass" AS ENUM ('LOW','MEDIUM','HIGH');
  END IF;
END $$;

ALTER TABLE "workflow_definitions"
  ADD COLUMN IF NOT EXISTS "certification_status" "WorkflowCertificationStatus" NOT NULL DEFAULT 'DRAFT';

ALTER TABLE "workflow_definitions"
  ADD COLUMN IF NOT EXISTS "risk_class" "WorkflowRiskClass";

CREATE TABLE IF NOT EXISTS "automation_certifications" (
  "id"                        TEXT                    NOT NULL,
  "automation_id"             TEXT                    NOT NULL,
  "workflow_version"          INTEGER                 NOT NULL,
  "certified_at"              TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "certified_by"              TEXT                    NOT NULL,
  "approval_reference"        TEXT,
  "shadow_evidence_reference" TEXT,
  "test_evidence_reference"   TEXT,
  "risk_class"                "WorkflowRiskClass"     NOT NULL,
  "known_limitations"         TEXT,
  "approved_execution_mode"   "WorkflowExecutionMode" NOT NULL DEFAULT 'SHADOW',
  "created_at"                TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_certifications_pkey" PRIMARY KEY ("id")
);

-- One certification per version. A new version earns its own.
CREATE UNIQUE INDEX IF NOT EXISTS "automation_certifications_automation_version_key"
  ON "automation_certifications" ("automation_id", "workflow_version");

CREATE INDEX IF NOT EXISTS "automation_certifications_automation_idx"
  ON "automation_certifications" ("automation_id", "certified_at");
