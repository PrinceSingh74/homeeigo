# Phase 2 — ETA Intelligence Implementation Summary

**Version:** 2.0  
**Date:** 2026-08-07  
**Scope:** Label collection only — NO ML inference

---

## What Was Built

### Data Pipeline
- **PostgreSQL:** `eta_training_labels`, `eta_google_snapshots`, `eta_gps_tracks`
- **BigQuery:** `eta_raw`, `eta_validated`, `eta_feature`, `eta_training`, `eta_prediction_history`
- **Feature Store:** `fs_eta_features_v2` (new `eta` feature group)
- **ETL Job:** `etl.eta` with incremental sync

### Event Flow
```
Booking Completed → eta-label.v1 consumer → EtaIntelligenceService
  → Validate → Feature Engineer → PG + BQ
  → eta.label.created / eta.trip.completed / eta.feature.updated
```

Phase 1 `ml-feature-sink.v1` on `partner.arrived` remains unchanged (backward compatible).

### Label Definition
```
actual_travel_duration_sec = arrivalTimestamp - dispatchTimestamp
```

### Admin APIs (RBAC: ADMIN)
| Endpoint | Purpose |
|----------|---------|
| `GET /api/analytics/eta` | Dashboard stats |
| `GET /api/analytics/eta/quality` | Quality report |
| `GET /api/analytics/eta/readiness` | Training readiness |
| `GET /api/analytics/eta/trips` | Recent trip labels |
| `GET /api/analytics/eta/google` | Google API capture stats |

### Observability
- Metrics: `homigo_eta_labels_total`, `homigo_eta_quality_score`, `homigo_eta_training_ready`, etc.
- Grafana: `homigo-eta-intelligence.json`
- Alerts: missing labels, quality low, Google latency, failure spike

### Admin UI
- `/eta-intelligence` — ETA Intelligence Command Center page

---

## Deployment Steps

1. Apply migration:
   ```bash
   cd apps/backend && bun run prisma migrate deploy
   ```

2. Deploy BigQuery DDL:
   ```bash
   bun run --env-file=.env scripts/deploy-bigquery-ddl.ts
   ```

3. Run certification:
   ```bash
   bun run --env-file=.env scripts/phase-2-certification.ts
   ```

4. Import Grafana dashboard from `monitoring/grafana/dashboards/homigo-eta-intelligence.json`

---

## Forbidden (Phase 2)

- No ML model training or inference
- No customer ETA changes
- No synchronous Google API on booking path
- No Phase 3 work

---

## Documentation

- ADR-014: `docs/architecture/adr-014-phase-2-eta-intelligence.md`
- Runbook: `docs/operations/PHASE-2-ETA-RECOVERY-RUNBOOK.md`
- Evidence: `docs/evidence/phase-2/eta-intelligence-certification.json`
