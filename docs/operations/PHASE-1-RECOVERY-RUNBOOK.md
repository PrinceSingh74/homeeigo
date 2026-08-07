# Phase 1 Recovery Runbook

## ETL Job Failure

1. Check execution history: `GET /api/analytics/etl/executions/{jobId}`
2. Query PostgreSQL: `SELECT * FROM etl_job_executions WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 10;`
3. Check Prometheus: `homigo_etl_jobs_total{status="failure"}`
4. Retry: `POST /api/analytics/etl/run` with `{ "jobIds": ["etl.booking"], "runMode": "RECOVERY" }`

## Watermark Corruption

1. Inspect: `SELECT * FROM etl_watermarks WHERE job_id = 'etl.booking';`
2. Reset and replay: run with `runMode: "REPLAY"` via admin API
3. Backfill: `runEtlBackfill('etl.booking', new Date('2025-01-01'))`

## Data Quality Critical Failure

1. Check: `GET /api/analytics/quality`
2. Review repair suggestions in response
3. Quarantine bad rows in BigQuery validated layer
4. Re-run DQ: triggers automatically after ETL

## Freshness SLA Violation

1. Check: `GET /api/analytics/freshness/sla-violations`
2. Verify scheduler: `homigo_etl_scheduler_runs_total`
3. Manual sync: `POST /api/analytics/etl/run`
4. If BigQuery unavailable: check GCP credentials and dataset existence

## BigQuery Schema Drift

1. Apply missing DDL: `analytics/bigquery/05_phase1_layers.sql`
2. Re-run dimensions job: `etl.dimensions` with FULL mode
3. Verify: `GET /api/analytics/quality`

## Feature Store Stale

1. Check feature metadata: `GET /api/analytics/features/metadata`
2. Export fresh training set: `POST /api/analytics/features/export`
3. Retrain: `bun run src/scripts/train-models.ts`

## Rollback

1. List versions: `GET /api/analytics/versions/pipeline`
2. Rollback: `POST /api/analytics/versions/rollback` with `{ "versionType": "pipeline", "versionTag": "..." }`

## Escalation

- Critical DQ failures → Finance + Data Engineering
- ETL failures > 5 in 24h → On-call SRE (Alertmanager: `EtlJobsFailed24h`)
- SLA violations > 2 hours → Platform team
