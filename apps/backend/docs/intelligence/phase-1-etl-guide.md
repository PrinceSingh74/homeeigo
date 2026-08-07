# Phase 1 ETL Operations Guide

## Overview
The Phase 1 ML Data Platform syncs PostgreSQL operational data to BigQuery through an enterprise ETL engine with incremental watermarks, data quality checks, and freshness monitoring.

## Architecture

```
PostgreSQL → ETL Engine → DQ Engine → BigQuery → Feature Store → ARIMA_PLUS Models
                ↑
         Leader Lock (Redis)
         maintenance.ts tick
```

## Running ETL

### Manual (full pipeline)
```bash
cd apps/backend
bun run --env-file=.env src/scripts/run-etl.ts
```

### Single job
```bash
bun -e "import { runEtlJob } from './analytics/etl/engine'; runEtlJob('etl.booking', { runMode: 'INCREMENTAL' }).then(console.log)"
```

### Admin API
```
POST /api/analytics/etl/run
GET  /api/analytics/etl/watermarks
GET  /api/analytics/freshness
GET  /api/analytics/quality
```

## Scheduler
- Enabled by default via `startEtlScheduler()` in maintenance loop
- Disable: `ENABLE_ETL_SCHEDULER=false`
- Interval: `ETL_INTERVAL_MS` (default 15 min)
- Full sync: daily at 02:00 UTC

## Recovery

### Replay from watermark
```bash
bun -e "import { runEtlJob } from './analytics/etl/engine'; runEtlJob('etl.payment', { runMode: 'REPLAY' })"
```

### Backfill from date
```bash
bun -e "import { runEtlBackfill } from './analytics/etl/engine'; runEtlBackfill('etl.booking', new Date('2025-01-01'))"
```

### Check execution history
```sql
SELECT * FROM etl_job_executions WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 20;
```

## BigQuery Setup
```bash
# Apply DDL in order
bq query --use_legacy_sql=false < analytics/bigquery/05_phase1_layers.sql
bq query --use_legacy_sql=false < analytics/bigquery/06_feature_store_v2.sql
bq query --use_legacy_sql=false < analytics/bigquery/07_demand_forecast_upgrade.sql
```

## Model Training
```bash
bun run --env-file=.env src/scripts/train-models.ts
```

## Certification
```bash
bun run --env-file=.env scripts/phase-1-certification.ts
RUN_LIVE_ETL_CERT=true bun run --env-file=.env scripts/phase-1-certification.ts
```

## Metrics (Prometheus)
- `homigo_etl_jobs_total{job_id,domain,status,run_mode}`
- `homigo_etl_duration_seconds{job_id}`
- `homigo_data_quality_score`
- `homigo_data_freshness_lag_seconds{dataset}`
- `homigo_data_freshness_sla_met{dataset}`

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| GCP_PROJECT_ID | homigo-497619 | BigQuery project |
| BQ_DATASET | homigo_analytics | Curated dataset |
| ETL_BATCH_SIZE | 2000 | Rows per batch |
| ETL_INTERVAL_MS | 900000 | Scheduler interval |
| ENABLE_ETL_SCHEDULER | true | Enable auto-sync |
