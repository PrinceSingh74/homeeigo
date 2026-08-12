# Phase 2 Audit — ETA Intelligence + ML Data Collection

**Score: 88%** · **HEAD:** `b582ead` · Audit-only

## Summary

The most disciplined phase in the platform. Every label and feature the roadmap asked for is captured, all four BigQuery layers are targeted, and — critically — **ML inference has correctly *not* been activated**. The roadmap explicitly warned against forcing ML prematurely; this phase obeyed that instruction. The low label count is a data-volume condition, not an implementation gap.

## Runtime Evidence

```
labels by status:  { TRAINING_READY: 3 }
google snapshots:  13
gps tracks:        3
TRAINING_READY:    3 / 50 required  ->  STILL COLLECTING (correct per roadmap)
ETA events published: homigo.eta.label.created 4, .trip.completed 1, .feature.updated 1
```

## Roadmap Label Coverage — all 11 present

| Required | Implementation | Source |
|---|---|---|
| dispatchedAt | `dispatchTimestamp` (from `AssignmentAttempt` or `assignedAt`) | `eta-intelligence.service.ts:76-82` |
| enRouteAt | `enRouteTimestamp` | `:187-188` |
| arrivedAt | `arrivalTimestamp` | `:83` |
| actual travel duration | sec + min, clamped ≥0 | `:85-88, 199-201` |
| distance | Haversine to address, tracking fallback | `:102-109` |
| hour | `hour`, plus `minute` | `:210-211` |
| day | `weekday`, `month`, `isWeekend` | `:208-212` |
| weather | Live service: rain, temp, humidity, wind, condition | `:214-218` |
| city | From booking address | `:179` |
| service category | From service relation | `:182` |
| Google ETA | sec + min + `EtaGoogleSnapshot` w/ latency + status | `:202-204`, `captureGoogleSnapshot` |

## Requirement Detail

**GPS capture + compression — IMPLEMENTED.** Location history is rounded to 5 decimals, gzipped, and stored in `EtaGpsTrack` with ping count, first/last timestamps, average accuracy, and sampling Hz. Sensible engineering — the compression is real, not nominal.

**Validation + quality scoring — IMPLEMENTED.** `analytics/eta/validation.ts` produces `qualityScore`, `status`, and `rejectionReasons`; rejected labels are excluded from the validated BQ layer.

**Feature engineering — IMPLEMENTED.** `analytics/eta/feature-engineering.ts` derives bearing, route efficiency, average speed, peak/night/rush flags, distance and trip buckets, partner familiarity, historical averages, and weather bucket.

**BigQuery layers — IMPLEMENTED (all four).** `raw.eta_raw` always; `validated.eta_validated` when not rejected; `feature.eta_feature` and `analytics.eta_training` when `TRAINING_READY`. Failures are caught and logged as deferred rather than breaking the booking flow — correct fail-safe posture.

**Events → outbox → consumer → idempotency — IMPLEMENTED.** Three ETA events ride the Phase 0 outbox (no parallel infrastructure). Namespace defect fixed in `914c7dd`; new events now publish in 1 attempt.

**Observability — IMPLEMENTED (metrics/alerts), PARTIAL (dashboard).** `lib/eta-metrics.ts` records label creation, failures, collection latency, Google latency, distance buckets, training-ready gauge. Five `homigo_eta*` alert references. `homigo-eta-intelligence.json` authored but **not mounted** in the running Grafana.

**Admin API + UI — IMPLEMENTED.** `/eta-intelligence` console page; dashboard/quality/readiness/trips endpoints in the service.

**ML restraint — IMPLEMENTED (and correct).** No inference path exists. Customer-facing ETA remains Google-based. `getReadinessReport()` gates on `MIN_LABELS = 50`. This is exactly the roadmap's intent and should not be "fixed."

## Assessment

If the pipeline had volume, this phase would score in the mid-90s. The 12-point deduction is: 3/50 labels (collection rate), and the undeployed dashboard.

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P1-3 | eta-intelligence dashboard not deployed | P1 |
| P1-4 | Label collection rate low (3/50) — depends on booking volume | P1 |
