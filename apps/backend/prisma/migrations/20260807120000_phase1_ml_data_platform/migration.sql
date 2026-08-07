-- Phase 1: Enterprise ML Data Platform tables
-- CreateEnum
CREATE TYPE "EtlJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RECOVERING');
CREATE TYPE "EtlRunMode" AS ENUM ('INCREMENTAL', 'FULL', 'RECOVERY', 'BACKFILL', 'REPLAY');
CREATE TYPE "DataQualitySeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "etl_watermarks" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "low_watermark" TIMESTAMP(3),
    "high_watermark" TIMESTAMP(3),
    "cursor_id" TEXT,
    "rows_synced" BIGINT NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "pipeline_version" TEXT NOT NULL DEFAULT '1.0.0',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etl_watermarks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "etl_job_executions" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "run_mode" "EtlRunMode" NOT NULL,
    "status" "EtlJobStatus" NOT NULL DEFAULT 'PENDING',
    "trace_id" TEXT,
    "correlation_id" TEXT,
    "batch_size" INTEGER NOT NULL DEFAULT 1000,
    "rows_processed" BIGINT NOT NULL DEFAULT 0,
    "rows_loaded" BIGINT NOT NULL DEFAULT 0,
    "low_watermark" TIMESTAMP(3),
    "high_watermark" TIMESTAMP(3),
    "cursor_start" TEXT,
    "cursor_end" TEXT,
    "duration_ms" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "metadata" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etl_job_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_results" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "severity" "DataQualitySeverity" NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "violation_count" INTEGER NOT NULL DEFAULT 0,
    "sample_violations" JSONB,
    "repair_suggestion" TEXT,
    "quality_score" DOUBLE PRECISION,
    "execution_id" TEXT,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_freshness_snapshots" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "lag_seconds" INTEGER,
    "freshness_score" DOUBLE PRECISION,
    "staleness_score" DOUBLE PRECISION,
    "delay_seconds" INTEGER,
    "sla_target_seconds" INTEGER NOT NULL DEFAULT 3600,
    "sla_met" BOOLEAN NOT NULL DEFAULT false,
    "pipeline_health" TEXT NOT NULL DEFAULT 'unknown',
    "source_row_count" BIGINT,
    "target_row_count" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_freshness_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_versions" (
    "id" TEXT NOT NULL,
    "version_type" TEXT NOT NULL,
    "version_tag" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "pipeline_version" TEXT NOT NULL,
    "dataset_version" TEXT,
    "feature_version" TEXT,
    "training_version" TEXT,
    "checksum" TEXT,
    "metadata" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rollback_of" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ml_feature_staging" (
    "id" TEXT NOT NULL,
    "sink_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_feature_staging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etl_watermarks_job_id_key" ON "etl_watermarks"("job_id");
CREATE INDEX "etl_watermarks_dataset_last_sync_at_idx" ON "etl_watermarks"("dataset", "last_sync_at");
CREATE INDEX "etl_job_executions_job_id_status_created_at_idx" ON "etl_job_executions"("job_id", "status", "created_at");
CREATE INDEX "etl_job_executions_trace_id_idx" ON "etl_job_executions"("trace_id");
CREATE INDEX "etl_job_executions_correlation_id_idx" ON "etl_job_executions"("correlation_id");
CREATE INDEX "etl_job_executions_status_created_at_idx" ON "etl_job_executions"("status", "created_at");
CREATE INDEX "data_quality_results_dataset_evaluated_at_idx" ON "data_quality_results"("dataset", "evaluated_at");
CREATE INDEX "data_quality_results_rule_id_evaluated_at_idx" ON "data_quality_results"("rule_id", "evaluated_at");
CREATE INDEX "data_quality_results_severity_passed_idx" ON "data_quality_results"("severity", "passed");
CREATE UNIQUE INDEX "data_freshness_snapshots_dataset_key" ON "data_freshness_snapshots"("dataset");
CREATE INDEX "data_freshness_snapshots_sla_met_updated_at_idx" ON "data_freshness_snapshots"("sla_met", "updated_at");
CREATE UNIQUE INDEX "data_versions_version_type_version_tag_key" ON "data_versions"("version_type", "version_tag");
CREATE INDEX "data_versions_version_type_is_active_idx" ON "data_versions"("version_type", "is_active");
CREATE INDEX "ml_feature_staging_sink_type_processed_created_at_idx" ON "ml_feature_staging"("sink_type", "processed", "created_at");
CREATE INDEX "ml_feature_staging_event_id_idx" ON "ml_feature_staging"("event_id");
