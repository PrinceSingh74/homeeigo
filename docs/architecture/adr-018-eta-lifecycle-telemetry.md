# ADR-018 — ETA Lifecycle Telemetry

**Status:** Accepted · **Date:** 2026-08-09 · **Supersedes parts of:** [ADR-014](./adr-014-phase-2-eta-intelligence.md)
**Related:** [ETA Training Eligibility Contract](./eta-training-eligibility-contract.md)

---

## Context

Phase-2 ETA label collection was starved. Of 108 completed bookings:

| Stage | Count | Coverage |
| --- | ---: | ---: |
| COMPLETED | 108 | 100 % |
| `startedAt` present | 107 | 99.1 % |
| **`enRouteAt` present** | **3** | **2.8 %** |
| **`arrivedAt` present** | **3** | **2.8 %** |
| duration ≥ 60 s | 0 | 0 % |
| **training-eligible** | **0** | **0 %** |

The event stream showed the same collapse: 212 `homigo.partner.dispatched` against 3
`homigo.partner.en_route` and 4 `homigo.partner.arrived`.

A forensic audit established that the downstream half of the pipeline — events, outbox,
consumer, label generation — was healthy. The collector produced a label for every
booking that reached it. The loss was entirely upstream.

### Root cause

`enRouteAt` and `arrivedAt` had **no explicit producer**. They were written only as a
side effect of a continuous GPS stream that only `partner-web` emitted, and only while a
browser tab held an open WebSocket. `booking.service.start()` accepted
`ACCEPTED|ASSIGNED|EN_ROUTE` and transitioned straight to `IN_PROGRESS`, so any job
started without that stream having cleared the 100 m / 2-ping geofence lost both
timestamps permanently. `homigo-partner-mobile` had no GPS publisher at all, so mobile
partners could never produce either timestamp.

Three supporting defects:

1. The job-start fallback wrote `arrivedAt` but never `enRouteAt`.
2. The label's `actualTravelDurationSec` was **always** `arrived − dispatched`, even when
   `enRouteAt` existed. `enRouteTimestamp` was stored and never used.
3. `booking.service.ts` swallowed every fallback failure with `.catch(() => undefined)`.

Defect 2 was the most damaging because it was silent: dispatch-to-arrival includes accept
latency and idle time, while `google_eta_seconds` measures pure travel. The two were
being compared as if they meant the same thing.

---

## Decision

### 1. Explicit lifecycle actions are authoritative

```
POST /api/bookings/:id/en-route     ACCEPTED | ASSIGNED  ->  EN_ROUTE, writes enRouteAt
POST /api/bookings/:id/arrived      writes arrivedAt (status unchanged)
```

Both follow the existing `/accept` and `/start` conventions: `requireProvider()`,
`validate(idParamSchema)`, `parseBody(geoPingSchema)`, `{ success, message, data }`.
Both are idempotent and report `newlyTransitioned`, mirroring `/accept`'s
`newlyAccepted`. The server owns every timestamp — clients only report position, so a
wrong device clock cannot corrupt a training label.

### 2. GPS is corroboration, not the producer

The geofence path still runs and still records arrival when it fires first. All three
producers — explicit action, geofence, job start — funnel into
`trackingService.recordArrival()`, idempotent on `arrivedAt: null`, so they race safely
and whichever lands first wins.

Geofence thresholds are unchanged (100 m radius, 2 near pings, 60 s TTL, accuracy and
speed gates). Missing telemetry was **not** solved by loosening them.

### 3. Timestamp persistence is decoupled from event flags

`maybeTransitionEnRoute` and `maybeRecordArrival` previously returned early when
`outboxEnabled` or `trackingEventsEnabled` was false, so turning event publishing off
also stopped writing business state. Now the DB write always executes and only
`emitInTransaction` is flag-gated. A travel-start anchor cannot be recovered later; an
unpublished event can.

### 4. One duration definition

```
actualTravelDurationSec = arrivedAt − enRouteAt
```

Stated once, in `ETA_TRAINING_CONTRACT.durationFormula`. **No anchor means no duration.**
It is never substituted with dispatch or assignment time. A label without a travel-start
anchor gets `missing_travel_start`, a training-blocking reason that caps it at
`VALIDATED` regardless of quality score — matching how BigQuery hard-excludes such rows.

Each label records `durationAnchor` in its `features` JSON, so a future contract change
cannot silently reinterpret rows written under this one.

### 5. Provenance travels with every timestamp

| Field | Values |
| --- | --- |
| `enRouteSource` | `explicit_partner_action`, `gps_geofence`, or `null` when no anchor |
| `arrivalSource` | `explicit_partner_action`, `gps_geofence`, `job_start` |

`explicit_partner_action` is unpenalised — nothing about it is inferred. `job_start`
keeps its −15 penalty (100 → 85) because it is later than true arrival by however long
the partner idled before beginning work. Both ride in the existing `features` JSON, the
precedent set by commit `4c4ffbf`.

**No schema migration was required** — `Booking.enRouteAt` and
`EtaTrainingLabel.enRouteTimestamp` already existed.

### 6. Mobile GPS is foreground-only, and says so

`expo-task-manager` is not installed; `app.json` declares neither
`ACCESS_BACKGROUND_LOCATION` nor iOS "Always" permission. Background tracking is
therefore impossible in this build and is **not faked**. The watcher stops when the app
backgrounds and resumes on return.

This is acceptable precisely because of decision 2: lifecycle timestamps no longer depend
on GPS, so a paused watcher costs corroboration, not the label.

Enabling background tracking would require `expo-task-manager`, new Android and iOS
permissions, a new native build, and an app-store justification for background location.
That is deliberately out of scope.

---

## Architecture

**Before**
```
partner-web only ──> GPS stream ──> geofence ──> enRouteAt + arrivedAt
partner-mobile   ──> (nothing)
job start        ──> arrivedAt only, enRouteAt lost, errors swallowed
label duration   ──> arrived − dispatched   (accept + idle folded in)
```

**After**
```
partner-web   ─┐
partner-mobile ─┴─> explicit en_route / arrived ──> authoritative timestamps
                     │
GPS stream ──────────┴─> corroboration + geofence fallback (idempotent race)
job start ───────────────> arrival fallback, observable, never fabricates enRouteAt

label duration ──> arrived − enRoute, or NULL (never substituted)
```

---

## Consequences

**Positive**
- Lifecycle capture no longer depends on a browser tab holding a socket open.
- Mobile reaches parity: both explicit actions plus a GPS publisher.
- One duration definition, enforced in code and asserted in tests.
- The `dispatched → en_route → arrived` funnel is visible on the ETA dashboard.
- Job-start fallback failures are logged and counted instead of vanishing.

**Negative / accepted**
- Partners now perform two extra taps per job. This is the cost of a truthful anchor;
  inferring it is what produced the wrong durations.
- Labels collected before this change carry dispatch-anchored durations. Re-running
  `scripts/eta-revalidate-labels.ts` recomputes them from stored timestamps and
  downgrades any that no longer qualify. Nothing is fabricated or deleted.
- **Training-eligible count remains 0.** This fixes collection; it does not manufacture
  trips. The threshold is 50 real eligible labels.

**Unchanged**
- ML training OFF, ML inference OFF, `model_eta` untouched.
- Google Maps remains the customer-facing ETA source (`booking.eta`).
- Synthetic quarantine intact: the `/^HOMIGO-\d{8}-\d{5}$/` allowlist and the BigQuery
  `is_synthetic = FALSE` gate both still apply.

---

## Implementation index

| Concern | Location |
| --- | --- |
| Lifecycle endpoints | `src/routes/bookings.ts` |
| Service methods | `src/services/booking.service.ts` (`markEnRoute`, `markArrived`) |
| Shared commit + idempotency | `src/services/tracking.service.ts` (`commitEnRoute`, `recordArrival`) |
| Event provenance | `src/events/catalog/partner.events.ts` |
| Duration + validation | `analytics/eta/validation.ts` (`ETA_TRAINING_CONTRACT`) |
| Label collection | `src/services/eta-intelligence.service.ts` |
| Re-validation tool | `scripts/eta-revalidate-labels.ts` (dry-run by default) |
| Metrics | `src/lib/eta-metrics.ts` |
| Dashboard | `monitoring/grafana/dashboards/homigo-eta-intelligence.json` |
| Web client | `apps/partner-web` — `services/partner-api.ts`, `hooks/use-partner-data.ts` |
| Mobile client | `homigo-partner-mobile` — `hooks/use-partner-tracking-publisher.ts` |
