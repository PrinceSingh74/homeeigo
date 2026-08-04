# HOMIGO PHASE 0 / STAGE D
# STEP 11 — REAL PARTNER LIFECYCLE & ETA-LABEL CERTIFICATION

**Date:** 2026-08-04  
**Auditor role:** Principal Backend Engineer / SRE / DRE / Event Architect / QA Lead  
**Certified RC (unchanged):** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Certified image digest:** `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32`  
**Job execution:** `homigo-step11-partner-cert-62v9f`

---

## Timestamp Ownership (RC c31f154)

| Label | Table | Column | Set By |
|-------|-------|--------|--------|
| dispatchedAt | `assignment_attempts` | `dispatched_at` | `assignment-engine.service.ts` |
| enRouteAt | `bookings` | `en_route_at` | `tracking.service.ts` maybeTransitionEnRoute |
| arrivedAt | `bookings` | `arrived_at` | `tracking.service.ts` maybeRecordArrival |
| travelDurationMin | `bookings` | `travel_duration_min` | Derived: `Math.max(1, round((arrivedAt-enRouteAt)/60000))` |

---

## Evidence Index

| File | Purpose |
|------|---------|
| `step-11-partner-certification.md` | This report |
| `step-11-business-state.json` | Final provider/booking state |
| `step-11-partner-events.json` | Five-event partner matrix |
| `step-11-consumer-receipts.json` | Consumer receipt proof |
| `step-11-eta-labels.json` | ETA / ML label integrity |
| `step-11-tracking.json` | Synthetic GPS sequence |
| `step-11-metrics.json` | Outbox/DLQ metrics |
| `step-11-notification-regression.json` | Notification regression |
| `step-11-runtime-health.json` | Identity + pre-flight |

**Forensics policy:** KEEP_FOR_FORENSICS — test records retained on authoritative staging DB.

**Secret scan:** PASS (no DATABASE_URL, tokens, or Razorpay secrets in evidence)  
**PII scan:** PASS (synthetic @homigo-staging.test fixtures only)

---

## Non-Critical Warnings

1. Local git HEAD (`6c8b937…`) differs from certified RC — certification executed against deployed Cloud Run image `c31f154`, not local tree.
2. Two failed dry-run attempts (`kf6tx`, `dkgw6`) during harness tuning (GPS throttle + fixture uniqueness); superseded by passing run `62v9f`.

---

## Production Safety

All production resources **UNTOUCHED**. Staging-only DB, Redis, Razorpay test keys.
