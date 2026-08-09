# ETA Lifecycle — Partner Mobile Real-Device Test Plan

**Status:** NOT VERIFIED · **Applies to:** `homigo-partner-mobile` · **Contract:** [ADR-018](../architecture/adr-018-eta-lifecycle-telemetry.md)

This plan exists because real-device verification could not be executed in the development
environment. Nothing here has been run. Every row below must be marked by a human tester
on physical hardware before mobile telemetry can be called production-ready.

---

## Why a device is required

Three behaviours cannot be reproduced by a simulator or by API testing:

1. **OS location-permission state machine** — grant, deny, and *revoke while running* are
   distinct paths. `Location.requestForegroundPermissionsAsync()` returns different results
   for each, and revocation mid-session is only reachable through Settings.
2. **App lifecycle under a real OS** — `AppState` transitions caused by the launcher, a
   phone call, or the OS reclaiming memory differ from a simulator's backgrounding.
3. **Real GPS behaviour** — accuracy drift, cold-start fix delay, and tunnel/indoor loss.

## Build

```
cd homigo-partner-mobile
npx expo run:android          # dev build; Expo Go cannot host this app
```

Point the app at a reachable backend (`EXPO_PUBLIC_API_URL`, or USB via
`adb reverse tcp:3000 tcp:3000`).

---

## The invariant under test

> **Explicit lifecycle actions must never depend on GPS.**
> `enRouteAt` and `arrivedAt` must be captured when the partner taps the button, even
> with location permission denied, GPS switched off, or no fix available.

If any GPS-related row below blocks a lifecycle action, the build **fails** this plan —
that is the exact coupling ADR-018 removed.

---

## A. Happy path

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| A1 | Accept a dev booking | Card shows **On my way** | ☐ |
| A2 | Tap **On my way** | Toast "On your way"; card advances | ☐ |
| A3 | Query DB | `bookings.en_route_at` set; status `EN_ROUTE` | ☐ |
| A4 | Walk/drive ≥ 2 min toward the address | GPS pings stream while app is foreground | ☐ |
| A5 | Card now shows **I've arrived** | Only the one legal next action is offered | ☐ |
| A6 | Tap **I've arrived** | Toast "Arrival recorded" | ☐ |
| A7 | Query DB | `arrived_at` set; `arrived_at > en_route_at` | ☐ |
| A8 | Tap **Start job**, then **Complete job** | Booking reaches `COMPLETED` | ☐ |
| A9 | Query `eta_training_labels` | One row; `actual_travel_duration_sec == arrived_at − en_route_at` | ☐ |
| A10 | Inspect `features` | `arrivalSource` and `enRouteSource` both `explicit_partner_action` | ☐ |
| A11 | If the trip was ≥ 60 s | Label is `TRAINING_READY` | ☐ |

## B. Idempotency and recovery

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| B1 | Double-tap **On my way** rapidly | One timestamp, one `homigo.partner.en_route` event | ☐ |
| B2 | Double-tap **I've arrived** | One timestamp, one `homigo.partner.arrived` event | ☐ |
| B3 | Force-kill the app, reopen, tap the same action | Server reports `newlyTransitioned: false`; timestamp unchanged | ☐ |
| B4 | Airplane mode → tap action → restore network → retry | Exactly one transition after retry | ☐ |
| B5 | Confirm label count for the booking | Exactly **1** | ☐ |

## C. GPS independence — the critical section

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| C1 | **Deny** location permission at the prompt, then tap **On my way** | Action **succeeds**; `en_route_at` written | ☐ |
| C2 | Turn device GPS **off**, tap **I've arrived** | Action **succeeds**; `arrived_at` written | ☐ |
| C3 | Revoke permission in Settings while the app runs | No crash; publisher stops; lifecycle buttons still work | ☐ |
| C4 | Re-grant permission | Publisher resumes without restarting the app | ☐ |
| C5 | Indoors / no fix for 60 s | No spurious geofence arrival | ☐ |
| C6 | Low-accuracy fix (> 75 m) far from destination | Geofence does not fire (accuracy gate) | ☐ |

*Note:* under C1/C2 the request sends `latitude: 0, longitude: 0`. The server records the
timestamp regardless — coordinates are corroboration only. Confirm the label still carries
`arrivalSource: explicit_partner_action`.

## D. Connectivity and app lifecycle

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| D1 | Background the app during an active job | GPS publisher stops (documented foreground-only limit) | ☐ |
| D2 | Foreground the app | Publisher reconnects; customer map resumes | ☐ |
| D3 | Toggle Wi-Fi ↔ mobile data mid-job | WebSocket reconnects; no duplicate transition | ☐ |
| D4 | Complete the job, then background | Publisher stops; no further pings | ☐ |
| D5 | Screen off for 2 min mid-job | Pings pause; **lifecycle timestamps unaffected** | ☐ |

## E. Negative paths

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| E1 | Tap **I've arrived** first, without **On my way** | Arrival recorded; label gets `missing_travel_start`, not `TRAINING_READY` | ☐ |
| E2 | After E1, wait for GPS pings near the address | `en_route_at` stays **NULL** — no backwards-in-time write | ☐ |
| E3 | Attempt an action on a cancelled booking | Rejected, HTTP 400 | ☐ |
| E4 | Sign in as a different partner, attempt the same booking | Rejected, HTTP 404 | ☐ |

E2 is the mobile expression of the regression closed in `commitEnRoute`; it is covered by
automated scenario S4 and should be confirmed once on hardware.

---

## Recording results

For each row mark **PASS**, **FAIL**, or **NOT RUN**. Do not infer a pass from a related
row. Attach for any FAIL: device model, OS version, app build, timestamp, and the relevant
`bookings` / `eta_training_labels` rows.

Verification queries:

```sql
SELECT booking_number, status, en_route_at, arrived_at, completed_at
FROM bookings WHERE booking_number = :n;

SELECT status, quality_score, actual_travel_duration_sec,
       en_route_timestamp, arrival_timestamp,
       features->>'arrivalSource'  AS arrival_source,
       features->>'enRouteSource'  AS en_route_source,
       features->>'durationAnchor' AS duration_anchor,
       rejection_reason
FROM eta_training_labels WHERE booking_id = :id;

SELECT event_type, status, payload->'data'->>'enRouteSource' AS en_route_source,
       payload->'data'->>'arrivalSource' AS arrival_source
FROM event_outbox
WHERE payload->'data'->>'bookingId' = :id
ORDER BY created_at;
```

## Out of scope

Background location. `expo-task-manager` is not installed and the app declares neither
`ACCESS_BACKGROUND_LOCATION` nor iOS "Always" permission. Enabling it needs a new native
build and an app-store justification, and is deliberately not part of this plan — see
ADR-018 §6.

## Sign-off

| Field | Value |
| --- | --- |
| Tester | |
| Device / OS | |
| App build | |
| Backend commit | |
| Date | |
| Verdict | PASS / FAIL / PARTIAL |
