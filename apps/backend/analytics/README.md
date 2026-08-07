# HOMIGO Analytics Platform (Phase 1)

Enterprise ML data foundation extending Phase 0 certified architecture.

## Structure

```
analytics/
├── config.ts              Job definitions, BQ dataset config
├── etl/
│   ├── engine.ts          ETL orchestrator (incremental/full/recovery/backfill/replay)
│   ├── checkpoint.ts      Watermark management
│   ├── bq-client.ts       BigQuery load utilities
│   ├── pii.ts             DPDP-safe PII hashing
│   └── jobs/              Domain-specific extractors (15 domains)
├── scheduler/
│   └── etl-scheduler.ts   Leader-locked scheduler (extends maintenance.ts)
├── data-quality/
│   └── engine.ts          Rule engine with severity + repair suggestions
├── freshness/
│   └── service.ts         SLA monitoring per dataset
├── feature-store/
│   └── service.ts         Versioned feature layers
├── versioning/
│   └── service.ts         Dataset/feature/training version tracking
├── forecast/
│   └── demand-forecast.service.ts  ARIMA_PLUS multi-granularity
└── bigquery/
    ├── 01_schema.sql      Original warehouse DDL
    ├── 02_training_views.sql
    ├── 03_models.sql
    ├── 04_mlops.sql
    ├── 05_phase1_layers.sql    Raw/Validated/Feature/Analytics layers
    ├── 06_feature_store_v2.sql Feature store v2 views
    └── 07_demand_forecast_upgrade.sql  ARIMA_PLUS upgrade
```

## Quick Start

```bash
# Apply BigQuery DDL
bq query --use_legacy_sql=false < analytics/bigquery/05_phase1_layers.sql

# Run migration
bunx prisma migrate deploy

# Run ETL
bun run --env-file=.env src/scripts/run-etl.ts

# Certify
bun run --env-file=.env scripts/phase-1-certification.ts
```

## Integration Points

- **Phase 0 Outbox:** `etl.events` syncs published outbox events
- **Phase 0 Retry:** ETL uses `computeRetryDelayMs()` from events/core/retry.ts
- **Phase 0 Leader Lock:** Scheduler uses `runWithLeaderLock()` from distributed-scheduler.ts
- **Phase 0 ML Sink:** `ml-feature-sink.v1` extended for BQ feature ingestion
- **Phase 0 Metrics:** New `homigo_etl_*` metrics in existing Prometheus stack
