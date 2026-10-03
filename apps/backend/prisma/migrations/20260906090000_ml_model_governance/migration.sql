-- Phase 12 — ML model governance registry.
--
-- Additive only. No existing table is altered and no data is moved: the BigQuery model_registry
-- keeps the warehouse training record, and these tables hold the lifecycle that BigQuery cannot
-- enforce (it has no unique constraints, and this project's billing is disabled so it is
-- physically unwritable).

CREATE TYPE "MlModelStage" AS ENUM (
  'TRAINING', 'TRAINED', 'EVALUATED', 'CANDIDATE', 'SHADOW',
  'APPROVED', 'PRODUCTION', 'ROLLED_BACK', 'REJECTED', 'RETIRED'
);

CREATE TABLE "ml_model_versions" (
  "id"                     TEXT NOT NULL,
  "model_name"             TEXT NOT NULL,
  "version"                INTEGER NOT NULL,
  "stage"                  "MlModelStage" NOT NULL DEFAULT 'CANDIDATE',
  "dataset_version"        TEXT NOT NULL,
  "feature_version"        TEXT NOT NULL,
  "code_version"           TEXT NOT NULL,
  "artifact_ref"           TEXT NOT NULL,
  "artifact_hash"          TEXT,
  "metrics"                JSONB,
  "hyperparameters"        JSONB,
  "seed"                   INTEGER,
  "baseline_name"          TEXT,
  "beats_baseline"         BOOLEAN,
  "trained_at"             TIMESTAMP(3),
  "evaluated_at"           TIMESTAMP(3),
  "approved_by"            TEXT,
  "approved_at"            TIMESTAMP(3),
  "approval_note"          TEXT,
  "promoted_at"            TIMESTAMP(3),
  "superseded_version_id"  TEXT,
  "rolled_back_at"         TIMESTAMP(3),
  "rolled_back_by"         TEXT,
  "rolled_back_reason"     TEXT,
  "rejected_reason"        TEXT,
  "retired_at"             TIMESTAMP(3),
  "created_by"             TEXT NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ml_model_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ml_model_versions_model_name_version_key"
  ON "ml_model_versions"("model_name", "version");
CREATE INDEX "ml_model_versions_model_name_stage_idx"
  ON "ml_model_versions"("model_name", "stage");
CREATE INDEX "ml_model_versions_stage_created_at_idx"
  ON "ml_model_versions"("stage", "created_at");

-- The invariant the whole phase rests on: one model has at most one PRODUCTION version.
-- Enforced by the database rather than by the promotion function, so a concurrent second
-- promotion fails on the index instead of both succeeding.
CREATE UNIQUE INDEX "ml_model_versions_one_production_per_model"
  ON "ml_model_versions"("model_name") WHERE "stage" = 'PRODUCTION';

CREATE TABLE "ml_shadow_predictions" (
  "id"                   TEXT NOT NULL,
  "model_name"           TEXT NOT NULL,
  "candidate_version_id" TEXT NOT NULL,
  "production_version"   INTEGER,
  "entity_key"           TEXT NOT NULL,
  "predicted_for"        TIMESTAMP(3) NOT NULL,
  "predicted_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "candidate_value"      DOUBLE PRECISION NOT NULL,
  "production_value"     DOUBLE PRECISION,
  "actual_value"         DOUBLE PRECISION,
  "actual_at"            TIMESTAMP(3),
  CONSTRAINT "ml_shadow_predictions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ml_shadow_predictions_candidate_version_id_entity_key_key"
  ON "ml_shadow_predictions"("candidate_version_id", "entity_key");
CREATE INDEX "ml_shadow_predictions_model_name_predicted_for_idx"
  ON "ml_shadow_predictions"("model_name", "predicted_for");

ALTER TABLE "ml_shadow_predictions"
  ADD CONSTRAINT "ml_shadow_predictions_candidate_version_id_fkey"
  FOREIGN KEY ("candidate_version_id") REFERENCES "ml_model_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
