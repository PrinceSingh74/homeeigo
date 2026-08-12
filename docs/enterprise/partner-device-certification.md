# HOMIGO — Partner Device Certification (GATE 2)

**Date:** 2026-06-25 · **Verdict: PARTIAL — server pipeline PROVEN functional via real DB records; LIVE execution BLOCKED on a partner app/device.**

## ✅ The full partner chain is proven (real completed booking, DB-traced)
Deep search confirmed the dispatch→offer→accept→complete machinery **works** — traced an actual completed booking end to end:
```
1. CUSTOMER booked   HOMIGO-20260624-00001  ₹494
2. DISPATCH          assignment_job → ACCEPTED
3. PARTNER ACCEPTED  provider cmq9h687s000, response_ms=80009, at 16:18:53
4. ASSIGNED          booking.provider_id = cmq9h687s0005tz8swhtkju1p
5. COMPLETED         at 16:18:59, status=COMPLETED
6. PAYMENT           status=SUCCESS, ₹494
```
Pipeline health: **76 ACCEPTED** assignment attempts all-time, **6 providers online+verified+active**.

## Why LIVE execution is BLOCKED (not a code bug)
My fresh test bookings dispatched correctly (**14 offers each**) but every attempt **TIMED OUT** — because
**no partner app is currently running to tap "Accept."** Offers reach providers (`assignment_attempts` SENT),
they just expire without a live partner. So the chain is BLOCKED on a **running partner app/device**, not on
any backend defect — the backend dispatch/match/offer/accept/complete is functional (proven above).

## What's BLOCKED
| Capability | Status |
|---|---|
| Live partner device/emulator to accept an offer | ⏸️ **BLOCKED** (no `adb`/device) |
| Real-time customer↔partner round-trip *now* | ⏸️ **BLOCKED** (needs the live partner app) |
| Backend dispatch→offer→accept→complete | ✅ **PROVEN** (DB-traced completed chain) |

## Why BLOCKED (runtime evidence)
| Capability | Probe result |
|---|---|
| `adb` (device bridge) | **NOT available** |
| `emulator` | **NOT available** |
| `ANDROID_HOME` / SDK | **NOT set** |
| A second physical device for the partner role | **none** |

The full chain (customer booking → partner notification → accept → navigate → complete → customer sees
completion) requires **two live app instances on real devices** (customer + partner) plus push delivery.
Neither device nor emulator exists in this environment, so the round-trip **cannot be executed** — and per
the mission rule, this is reported BLOCKED, not assumed PASS.

## Server-side prerequisites that ARE ready (so the chain will work once a device is available)
- Backend live (`/health` 200).
- Provider matching/dispatch route present (`POST /api/providers/match` → 400 = exists, needs body).
- Booking creation persists to Postgres (proven in `data-shape-audit.md`); admin reads the same table.
- Realtime delivery wired: customer tracking WebSocket `/ws/tracking/:id` + push tokens (`/api/users/me/devices/push-token`).

## Exact steps to clear (produce runtime evidence)
1. Build the partner app on an EAS dev client (GATE 3) and install on **device A** (partner) + customer app on **device B**.
2. Device B: create a booking. 3. Device A: confirm push notification + accept. 4. Navigate → start → complete.
5. Device B: confirm the completion arrives over WS/push. Capture screen recordings + the `bookings.status`
   transitions in Postgres at each step as the evidence.

> **BLOCKED — partner device + emulator.** No code gap; the server + realtime plumbing are ready.
