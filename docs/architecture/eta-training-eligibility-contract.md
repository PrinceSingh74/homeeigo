# ETA Training Eligibility Contract

**Status:** Authoritative · **Phase:** 2 (ETA Intelligence — data collection)
**Applies to:** `eta_training_labels` (PostgreSQL) and the ETA layers in BigQuery

This document is the single definition of when an ETA label may be used to train a model.
It exists because the two layers previously disagreed: PostgreSQL marked 1-second trips
`TRAINING_READY` at quality 100 while BigQuery silently excluded them, so the readiness
metric counted labels that could never train.

---

## The contract

An ETA label is **training-eligible** only when **all** of the following hold:

| # | Condition | Threshold | Enforced in |
|---|---|---|---|
| 1 | Real business trip, not a fixture | `is_synthetic = false` | `isSyntheticBookingNumber()`, `vw_eta_training_eligible` |
| 2 | Dispatch timestamp present | not null | `validation.ts` (critical) |
| 3 | Arrival timestamp present | not null | `validation.ts` (critical) |
| 4 | Arrival not in the future | ≤ now + 60s | `validation.ts` (critical) |
| 5 | Travel duration non-negative | ≥ 0 | `validation.ts` (critical) |
| 6 | **Travel duration at or above the minimum** | **≥ 60 s** | `validation.ts`, BigQuery views |
| 7 | **Travel duration at or below the maximum** | **≤ 14 400 s (4 h)** | `validation.ts`, BigQuery views |
| 8 | Quality score at or above threshold | ≥ 70 | `validation.ts`, `vw_eta_training_eligible` |
| 9 | Validation status | `TRAINING_READY` | both layers |
| 10 | Provenance resolvable | `explicit_partner_action` \| `gps_geofence` \| `job_start` | `validation.ts`, `vw_eta_training_eligible` |
| 11 | Coordinates valid | lat ∈ [-90,90], lng ∈ [-180,180] | `validation.ts` (critical) |
| 12 | One canonical record per booking | `booking_id` unique | Postgres `@unique`, BigQuery MERGE |
| 13 | **Travel-start anchor present** | `enRouteAt` not null | `validation.ts` (`missing_travel_start`) |

### The duration formula (ADR-018)

```
actualTravelDurationSec = arrivedAt − enRouteAt
```

Stated once, in `ETA_TRAINING_CONTRACT.durationFormula`, and asserted in the contract
tests. **No anchor means no duration** — it is never substituted with dispatch or
assignment time.

This matters because the two measure different things. Dispatch-to-arrival includes
accept latency and idle time; `google_eta_seconds` measures pure travel. Comparing a
model trained on the former against the Google baseline compares two different
quantities. Before ADR-018 the collector always used `arrived − dispatched` even when
`enRouteAt` existed, and `enRouteTimestamp` was stored but never read.

Every label records the anchor it was computed under in `features.durationAnchor`, so a
later contract change cannot silently reinterpret older rows.

### Timestamp provenance

| Field | Values | Penalty |
|---|---|---|
| `enRouteSource` | `explicit_partner_action`, `gps_geofence`, `null` (no anchor) | none |
| `arrivalSource` | `explicit_partner_action` | none |
| | `gps_geofence` | none |
| | `job_start` | −15 (100 → 85) |

`explicit_partner_action` is the partner declaring the transition and is unpenalised —
nothing about it is inferred. `job_start` stays penalised because it is later than true
arrival by however long the partner idled before starting work. Both ride in the existing
`features` JSON; no schema migration was needed.

### Where the numbers come from

The 60 s minimum and 14 400 s maximum are **not new**. They have gated the BigQuery
training views since the original Phase 2 commit `7ff5683`:

```sql
-- 10_phase2_eta_intelligence.sql:113  and  :132
AND t.label_actual_travel_duration_sec BETWEEN 60 AND 14400
AND label_actual_travel_duration_min   BETWEEN 1 AND 240
```

The remediation made PostgreSQL agree with the warehouse rather than changing the
warehouse to agree with PostgreSQL. `MAX_TRAVEL_SEC` is the pre-existing constant.

### Why a minimum at all

A sub-minute gap between dispatch and arrival is not a physically real trip — it reflects
seeded data, a clock artefact, or a partner marking arrival at the moment of dispatch.
Training on such rows teaches a model that journeys take no time.

---

## Status semantics

| Status | Meaning | Trainable |
|---|---|---|
| `TRAINING_READY` | Meets every condition above | **Yes** |
| `VALIDATED` | Valid, retained, queryable — but outside the training contract | No |
| `REJECTED` | Corrupt or impossible data | No |

Two distinct exclusion mechanisms exist, and the difference matters:

**Critical reasons → `REJECTED`.** The data is wrong: `missing_timestamps`,
`negative_duration`, `future_timestamp`, `invalid_coordinates`.

**Training-blocking reasons → capped at `VALIDATED`.** The data is fine but falls outside
the contract: `duration_below_min`, `duration_outlier`, `invalid_provenance`,
`missing_travel_start`, `historical_provenance_unknown`.

`missing_travel_start` fires when arrival was captured without a departure anchor — the
job-start fallback case. The trip is real and the row is retained and queryable, but there
is no travel time to learn from, so it can never be `TRAINING_READY`.

`historical_provenance_unknown` fires when the arrival cannot be attributed to any
producer: the label predates provenance tracking, or its `partner.arrived` event has aged
out of the outbox. Such labels were previously tolerated and scored as if GPS-precise,
which silently promoted unverifiable arrivals to full training weight. **Unknown is never
treated as precise.** Provenance is resolved once at collection time — while the event is
still fresh — and persisted onto the label, so outbox retention cannot later erase it.

A training-blocking reason caps the status **regardless of quality score**. A 59-second
trip can score 85 and is still not trainable. A score penalty alone would not be enough —
BigQuery hard-excludes these rows in a `WHERE` clause, so PostgreSQL must hard-exclude
them too, or the two contracts drift apart again.

---

## Authoritative layer

**PostgreSQL `eta_training_labels` is the source of truth.** BigQuery mirrors it.

- Every non-`REJECTED` label is mirrored into `eta_feature` and `eta_training` carrying its
  **current** `validation_status`. Presence in the table is not eligibility.
- Eligibility is decided by **`vw_eta_training_eligible`**, which re-applies the contract.
- Writes use `mergeRows()` keyed on `booking_id`, so replay, retry, backfill and full runs
  all converge on one canonical row.

A label that is later downgraded propagates that downgrade to the warehouse. Gating the
warehouse write on `TRAINING_READY` previously left stale rows behind; it no longer does.

---

## Readiness metric

`homigo_eta_training_ready` and `getReadinessReport().trainingReady` both read from
**`etaIntelligenceService.countTrainingEligible()`** — the one authoritative calculation.

It counts `status = TRAINING_READY` **and** a production booking number, so the gauge can
never report labels the warehouse would reject.

`getReadinessReport()` also exposes `trainingReadyIncludingSynthetic` so an operator can
see the gap rather than have it hidden.

**Training threshold:** 50 eligible labels (`MIN_LABELS`).

---

## Synthetic data exclusion

Only `nextBookingNumber()` mints a production booking number, always as
`HOMIGO-YYYYMMDD-NNNNN`. The classifier is a regex **allowlist**:

```
/^HOMIGO-\d{8}-\d{5}$/
```

Anything else — `P2VERIFY-*`, `CERT-*`, `PROBE-*`, `ADV-*`, and any prefix invented in
future — is synthetic. Null or empty fails closed. A new fixture prefix is therefore
excluded by default rather than silently entering the training set.

`is_synthetic = true` must never become training-eligible.

---

## ML gate

**ETA ML inference is OFF and stays OFF in Phase 2.** Google Maps remains the
customer-facing ETA source (`booking.eta`).

The promotion path, in order — none of it is automatic:

```
real trips collect
  → labels generated
  → validation (60 s ≤ duration ≤ MAX, is_synthetic = false)
  → training-eligible dataset
  → enough real data (≥ 50)
  → candidate model trained
  → offline evaluation
  → champion vs Google ETA baseline
  → human approval / promotion gate
  → only then ML inference ON
```

`eta_prediction_history` exists as a Phase 3 placeholder and must stay empty while
inference is off.

---

## Current state (2026-08-08)

| Measure | Value |
|---|---|
| Labels stored | 4 |
| `TRAINING_READY` | 1 (synthetic fixture) |
| `VALIDATED` | 3 (real trips, durations 1 s / 35 s / 46 s — below the minimum) |
| **Training-eligible** | **0** |
| PostgreSQL ↔ BigQuery agreement | ✅ 0 == 0 |

Zero eligible labels is a **data maturity** condition, not a defect. The three real trips
are genuinely not trainable. As real bookings accumulate with plausible travel durations,
they will become eligible automatically.

---

## Implementation index

| Concern | Location |
|---|---|
| Validation + contract constants | `apps/backend/analytics/eta/validation.ts` (`ETA_TRAINING_CONTRACT`) |
| Synthetic classifier | `apps/backend/src/services/eta-intelligence.service.ts` (`isSyntheticBookingNumber`) |
| Authoritative count | `etaIntelligenceService.countTrainingEligible()` |
| Warehouse projection | `etaIntelligenceService.syncToBigQuery()` |
| Idempotent write | `apps/backend/analytics/etl/bq-client.ts` (`mergeRows`) |
| Eligibility view | `analytics/bigquery/11_phase2_eta_remediation.sql` (`vw_eta_training_eligible`) |
| One-off re-validation | `apps/backend/scripts/eta-revalidate-labels.ts` |
| Tests | `src/__tests__/eta-training-contract.test.ts` (24), `eta-arrival-provenance.test.ts` (9), `eta-synthetic-classifier.test.ts` (11) |
