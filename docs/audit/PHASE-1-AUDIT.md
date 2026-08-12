# Phase 1 Audit — Data + ML Pipeline Foundation

**Score: 68%** · **HEAD:** `b582ead` · Audit-only

## Summary

The machinery is built and demonstrably runs. The problem is that almost nothing flows through it. Several roadmap sub-requirements (backfill, replay, watermark semantics, model metrics) could not be evidenced and are recorded `NOT_VERIFIED` rather than assumed.

## Runtime Evidence

```
ml feature staging rows: 3
ETL jobs observed succeeding: booking, partner, location, notification,
  automation, events, audit, dimensions, payment, fraud, eta, customer, review
typical rowsLoaded: 0   (exceptions: audit 3000, dimensions 62, events 1)
```

## Requirement Detail

**ETL engine + domain jobs — IMPLEMENTED.** `analytics/etl/engine.ts` with ~17 job definitions. Runtime logs confirm successful execution with trace and correlation IDs.

**Incremental + Full loading — IMPLEMENTED.** `runMode: INCREMENTAL` on the interval path; `FULL` on the 02:00 UTC daily branch (`etl-scheduler.ts:74-78`), guarded by a `lastFullSyncDay` latch.

**Scheduler + leader locking — IMPLEMENTED.** `runWithLeaderLock(ETL_LOCK_KEY, 900, …)` — correctly reuses the Phase 0 primitive rather than introducing a second scheduler. This is the right call architecturally.

**Data quality + freshness — IMPLEMENTED.** `runDataQualityChecks()` and `refreshAllFreshness()` execute on every pipeline run.

**BigQuery layers — IMPLEMENTED (raw/validated/feature/analytics).** Confirmed by four distinct `loadRows` targets in `eta-intelligence.service.ts:538-580`. A "curated" layer was not observed — `NOT_VERIFIED`.

**Feature Store — PARTIAL.** `analytics/feature-store/service.ts` exists; `MlFeatureStaging` holds 3 rows. Present but effectively unexercised.

**Versioning — PARTIAL.** `createVersion("pipeline", …)` confirmed on each run. Dataset / feature / training version awareness not evidenced.

**Model metrics — NOT_VERIFIED.**

**ARIMA_PLUS demand forecast — PARTIAL.** `analytics/forecast/demand-forecast.service.ts` exists. The roadmap asks for it to be *production-grade* and consumed by partner demand, admin, surge, digital twin, earnings, and capacity planning. Admin and digital-twin UI pages exist, but the data path from forecast to each consumer was not traced — `NOT_VERIFIED`.

**Watermarks / backfill / replay / recovery — NOT_VERIFIED.** `analytics/etl/checkpoint.ts` exists but its semantics were not exercised.

**Observability — IMPLEMENTED (metrics/alerts), PARTIAL (dashboards).** Two `homigo_etl*` alert references. `homigo-analytics-pipeline.json` is authored but **not mounted** by the running Grafana.

**Admin API + UI — IMPLEMENTED.** `routes/analytics.ts`, `/analytics` console page.

## Assessment

The score is low not because the code is poor, but because a data pipeline that moves no data has not demonstrated the properties that matter — incremental correctness, watermark advancement, backfill recovery, throughput. Those need volume before they can be certified.

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P1-3 | analytics-pipeline dashboard not deployed | P1 |
| P1-4 | Pipeline runs empty (~0 rows) | P1 |
| P2-4 | Watermark/backfill/replay unverified | P2 |
| P2-6 | ARIMA_PLUS production-grade claim unproven | P2 |
