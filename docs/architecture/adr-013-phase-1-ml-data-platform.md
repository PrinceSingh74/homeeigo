# ADR-013: Phase 1 Enterprise ML Data Platform

## Status
Accepted

## Context
Phase 0 delivered a certified transactional outbox, event bus, retry/DLQ, and observability stack. Phase 1 must create the enterprise data foundation for all future ML/AI without duplicating Phase 0 components.

## Decision
Extend the existing Bun monolith with a modular analytics platform under `apps/backend/analytics/`:

```
PostgreSQL → ETL Engine → Data Quality → BigQuery (Raw/Validated/Curated/Feature/Analytics) → Feature Store → ML Models
```

### Key architectural choices

1. **ETL Engine** (`analytics/etl/engine.ts`) — incremental/full/recovery/backfill/replay with watermark checkpoints in PostgreSQL (`etl_watermarks`, `etl_job_executions`).

2. **Scheduler** (`analytics/scheduler/etl-scheduler.ts`) — extends Phase 0 `runWithLeaderLock()` in `maintenance.ts`; no separate scheduler microservice.

3. **Event integration** — `ml-feature-sink.v1` extended to persist ETA labels and trigger event-driven ETL; domain services remain decoupled from BigQuery.

4. **BigQuery layers** — five datasets: `_raw`, `_validated`, curated (`homigo_analytics`), `_feature`, `_analytics` with partition/cluster/retention policies.

5. **Feature Store** — versioned BQ views (`fs_*_features_v2`) with training/validation/testing export API.

6. **ARIMA_PLUS upgrade** — extends (not replaces) `model_demand_forecast` with hourly/daily/weekly/city/partner-earnings models.

7. **Observability** — new Prometheus metrics (`homigo_etl_*`, `homigo_data_quality_*`, `homigo_data_freshness_*`) integrated with existing Grafana/Alertmanager.

8. **Security** — SHA256 PII hashing at ETL boundary; ADMIN RBAC on all analytics APIs; DPDP-ready design.

## Consequences

### Positive
- Scales to millions of bookings without architectural redesign
- Reuses certified Phase 0 retry, leader election, metrics
- Reproducible, versioned data for ML training

### Negative
- BigQuery costs require monitoring (cost optimization via partitioning)
- Live certification requires GCP credentials

## Evidence
- `apps/backend/scripts/phase-1-certification.ts`
- `docs/final-certification/PHASE-1-CERTIFICATION-REPORT.md`

## References
- ADR-001 through ADR-012 (Phase 0)
- `apps/backend/docs/intelligence/phase-1-etl-guide.md`
