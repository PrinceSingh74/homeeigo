/**
 * HOMIGO Analytics ETL — PostgreSQL → BigQuery.
 * Phase 1: delegates to enterprise ETL engine in analytics/etl/.
 * Backward-compatible runEtl() export preserved for existing scripts.
 */
export { runEtl, runEtlPipeline, runEtlJob, runEtlBackfill, getExecutionHistory } from "../../analytics/etl/engine";
