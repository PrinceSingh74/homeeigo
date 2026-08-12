# Dead Code Audit — Phases 16/17/18

**Date:** 2026-06-14 · grep/usage-based.

## Resolved (were dead, now wired)
| Symbol | Was | Now |
|---|---|---|
| `CustomerTrackingMap` | unmounted (dead) | ✅ used in `BookingDetailModal` |
| `WalletCheckoutSummary` | unmounted (dead) | ✅ used in `BookingDetailModal` |
| `useBookingTracking` | unused | ✅ used by CustomerTrackingMap |
| `coreApi.wallet.checkout.*` | client only | ✅ used by WalletCheckoutSummary |
| `coreApi.geo.*` | partial | ✅ used by geo components |
| `ops-map.service` / `heatmap.service` / `geofence.service` | API only | ✅ consumed by admin screens |

## Removed
- Old razorpay-only "Complete payment" `ActionBtn` in `BookingDetailModal` (replaced by WalletCheckoutSummary) — removed with its now-unused `payForBooking`, `paymentProcessing`, `CreditCard` import.

## Still-unused / low-value (honest)
- `tracking.service` legacy `verifyWSToken` (superseded by `authenticateWsConnection`) — kept for back-compat, candidate for removal.
- `maps.service.geocode` (forward) — implemented, not yet called by any screen (autocomplete/place used instead). Keep (API completeness).
- `route-optimization.service` — service + API live but **no partner-web screen consumes it** → effectively dead on the frontend until the partner UI is built.
- `opsMapService.emit` (admin WS feed) — defined, not yet triggered on provider online/offline events (snapshot polling used). Wire on tracking presence transitions to activate.

## Duplicate (not dead, but redundant)
- Geofence CRUD exists in BOTH `routes/admin.ts` and `routes/geo.ts` (both → single `geofenceService`). One surface is redundant.

No orphaned models/tables introduced. No mock/fake-data code paths.
