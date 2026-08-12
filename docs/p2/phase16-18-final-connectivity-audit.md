# Phase 16–18 Final Connectivity Audit (execution-verified)

**Date:** 2026-06-14 · Evidence = actual mounts + live HTTP (admin token) + typecheck. No doc-trust.

## Gap closure (from the prior audit's PARTIAL/MISSING items)
| Item | Before | Now | Evidence |
|---|---|---|---|
| CustomerTrackingMap mount | unmounted | ✅ **mounted** | `BookingDetailModal.tsx` (2 refs) — renders when `canTrack` |
| WalletCheckoutSummary mount | unmounted | ✅ **mounted** | `BookingDetailModal.tsx` (2 refs) — renders when `paymentNeedsRecovery`; old razorpay-only button removed |
| Admin ops map UI | missing | ✅ **built + live** | `(console)/operations/page.tsx` → `GET /api/admin/ops-map` → `success=true, providers=2, bookings=26, alerts=27` |
| Admin heatmap UI | missing | ✅ **built + live** | `(console)/heatmap/page.tsx` → `GET /api/admin/heatmap` → `success=true, cells=5, demand=96` |
| Admin geofence manager | missing | ✅ **built + live** | `(console)/geofences/page.tsx` → `GET/POST/PATCH/DELETE /api/geo/geofences` → `success=true` |
| Sidebar nav | — | ✅ Live Ops / Demand Heatmap / Geofences added | `AdminSidebar.tsx` |

## Bug found & fixed during this audit (execution-only caught it)
- **`/api/admin/ops-map` → 500** `column "undefined" does not exist`. Root cause: `heatmap.service` grid resolution `ALLOWED_GRID.includes(gridSize ?? 0.05) ? gridSize! : 0.05` returned `undefined` when `gridSize` was omitted (ops-map passes none). **Fixed** → tests the actual `gridSize` (undefined ⇒ default 0.05). Re-verified: ops-map `success=true`. (heatmap UI worked because it passes `gridSize:0.05` explicitly.)
- **RBAC mapping:** `/api/admin/ops-map` + `/api/admin/heatmap` were unmapped in `admin-route-permissions.ts` → fail-closed 403. **Fixed** → mapped to `ANALYTICS:READ` (same as dashboard). Re-verified 200.

## End-to-end flows (UI → API → Service → DB)
| Flow | Path | Status |
|---|---|---|
| Customer track provider | BookingDetailModal → `useBookingTracking` → `/ws/tracking/:id` + `/api/tracking/:id` → tracking.service → `tracking`/`location_history` | ✅ CONNECTED |
| Customer wallet checkout | WalletCheckoutSummary → `coreApi.wallet.checkout` → `/api/wallet/checkout/*` → wallet-checkout.service → `wallet_transactions`/`journal_entries` | ✅ CONNECTED |
| Customer address autocomplete | AddAddressModal → `coreApi.geo` → `/api/geo/*` → maps.service | ✅ CONNECTED (haversine until key) |
| Customer nearby+ETA | BookPageClient → ProviderETA → `/api/geo/nearby-providers` → matching.service | ✅ CONNECTED |
| Admin live ops | operations/page → `adminApi.opsMap` → `/api/admin/ops-map` → ops-map.service (presence+heatmap+geofence) | ✅ CONNECTED |
| Admin heatmap | heatmap/page → `adminApi.heatmap` → `/api/admin/heatmap` → heatmap.service | ✅ CONNECTED |
| Admin geofence CRUD | geofences/page → `adminApi.geofences.*` → `/api/geo/geofences` → geofence.service → `geofences`/`geofence_events` | ✅ CONNECTED |
| Partner location → WS | tracking.ws → tracking.service → `location_history` + room broadcast | ✅ CONNECTED |
| Partner route optimize | `/api/providers/me/route/optimize` → route-optimization.service | ✅ API live (no partner-web UI mount yet — PARTIAL) |

## Remaining PARTIAL (honest)
- Partner-web has **no route-optimization screen** (API live).
- **Google Maps key** not set → autocomplete/Directions/map-embed use haversine/manual fallback.
- **No committed regression tests** for the new geo/tracking/checkout/heatmap features (verified via execution scripts).
- **Geofence duplicate route surface** (admin.ts + geo.ts) — not yet de-duped.

Typecheck: backend ✅, web ✅, admin-panel ✅.
