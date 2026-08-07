# ADR-014: Phase 2 ETA Intelligence Label Collection Platform

**Status:** Accepted  
**Date:** 2026-08-07  
**Owner:** Platform / Data Engineering  
**Supersedes:** None  
**Extends:** ADR-013 (Phase 1 ML Data Platform)

---

## Context

HOMIGO needs production-grade training labels for future ETA ML models. Phase 0 provides transactional outbox and event delivery. Phase 1 provides BigQuery five-layer warehouse, ETL, and feature store. Phase 2 adds **label collection only** — no ML inference, no customer-visible ETA changes.

Google Maps remains the source of truth for customer-facing ETA. Phase 2 captures Google ETA vs actual travel duration for every completed booking.

## Decision

Implement an **ETA Intelligence Data Collection Platform** that:

1. Listens to `homigo.booking.completed` via Phase 0 outbox consumer (`eta-label.v1`)
2. Assembles mandatory training labels from booking, partner, GPS, weather, and Google snapshot data
3. Validates labels (reject negative duration, GPS jumps, missing timestamps, future timestamps)
4. Engineers deterministic features (bearing, route efficiency, rush hour, distance buckets)
5. Persists to PostgreSQL (`eta_training_labels`) and BigQuery five layers:
   - `eta_raw` → `eta_validated` → `eta_feature` → `eta_training`
   - `eta_prediction_history` (placeholder for Phase 3 shadow mode)
6. Publishes `eta.label.created`, `eta.trip.completed`, `eta.feature.updated` events
7. Exposes ADMIN RBAC APIs at `/api/analytics/eta/*`
8. Adds Grafana dashboard and Prometheus metrics

**Explicitly forbidden in Phase 2:**
- ML model training or inference
- Customer ETA replacement
- Synchronous Google API calls on booking hot path
- Duplicate Phase 0/1 infrastructure

## Label Definition

```
actual_travel_duration = arrivalTimestamp - dispatchTimestamp
```

Supervised learning label stored in `eta_training.label_actual_travel_duration_sec`.

## Architecture

```
Booking Completed
  → Outbox → eta-label.v1 consumer
  → EtaIntelligenceService.collectLabelFromBooking()
  → Validate → Feature Engineer → PG + BQ
  → Emit eta.label.created / eta.trip.completed / eta.feature.updated
  → ETL etl.eta (scheduled + event-triggered)
  → Feature Store fs_eta_features_v2
```

GPS capture runs asynchronously during tracking; Google snapshots captured in `TrackingService.refreshGoogleEta()` without blocking location updates.

## Consequences

**Positive:**
- Clean, auditable training labels for Phase 3 ML
- Reuses certified Phase 0/1 patterns (outbox, ETL, feature store, metrics)
- Zero impact on booking flow (async collection)
- GDPR-ready (PII hashed, no raw customer data in warehouse)

**Negative:**
- Additional PG tables and BQ datasets to maintain
- Label quality depends on GPS ping density and timestamp accuracy

## Evidence

- Certification: `docs/evidence/phase-2/eta-intelligence-certification.json`
- Script: `apps/backend/scripts/phase-2-certification.ts`
- BigQuery DDL: `apps/backend/analytics/bigquery/10_phase2_eta_intelligence.sql`

## Review Date

2027-02-07
