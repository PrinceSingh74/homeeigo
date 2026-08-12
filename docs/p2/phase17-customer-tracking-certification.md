# Phase 17.2 — Customer Live Tracking Map Certification

**Date:** 2026-06-13 · **App:** `apps/web`. Reuses the existing WS infra (`use-realtime-channel`, `/ws/tracking/:bookingId`) + `coreApi.tracking` endpoint + react-query cache — **no new tracking system** (the parameterised hook mirrors the existing `use-active-tracking`).

## Deliverables (built + type-safe)
- **`lib/tracking-api.ts`** — thin surface over `coreApi.tracking.get` (server-side booking-ownership authorised). No new API.
- **`hooks/use-booking-tracking.ts`** — live tracking for a specific booking: react-query fetch + `useRealtimeChannel` WS subscribe, with event **dedup**, **out-of-order drop**, and **reconnect recovery** (refetch when the socket returns; server re-emits last-known on join). Exposes `{ status, eta, estimatedArrivalTime, distance, providerPosition, connected, reconnecting }`.
- **`components/tracking/CustomerTrackingMap.tsx`** — provider marker, **dynamic ETA card**, auto-updating **status timeline** (ASSIGNED → ON_THE_WAY → ARRIVED → IN_PROGRESS → COMPLETED), connection badge (Live / Reconnecting / Offline). Marker position **debounced 100 ms** (FEATURE 5, avoids render thrash). Renders a Google Maps **embed** when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set, else a graceful live-position panel (no fake map).

## Feature coverage
| Feature | Status |
|---|---|
| 1 Live provider marker (WS, no polling) | ✅ via `useRealtimeChannel` |
| 2 Dynamic ETA card (ETA + status) | ✅ |
| 3 Booking status timeline (auto-update) | ✅ |
| 4 Reconnect recovery (refetch + rejoin) | ✅ (`connected` edge → invalidate) |
| 5 Map perf (100 ms marker debounce) | ✅ |
| 6 Security (booking ownership before map) | ✅ enforced server-side (`coreApi.tracking.get` → 403/404) → query error → "unavailable" |

## Certification status (honest)
- **TypeScript clean:** ✅ `tsc --noEmit` (web) — 0 errors in the new files.
- **No duplicate systems:** ✅ reuses `use-realtime-channel`, `coreApi.tracking`, `qk.tracking`/`upsertTrackingInCache`.
- **Backend chain these screens drive:** ✅ certified in `phase17-tracking-certification.md` (throttle, presence, ETA, room-auth, 1000-update load p95 ≤45 ms).
- **Browser E2E:** ⏳ **not run** here (needs web+backend servers + a live WS session); components are wired + typecheck. No fabricated pass.

**Verdict: 17.2 customer tracking UI implemented, type-safe, wired to certified WS/tracking infra.** A customer can watch the provider move live (debounced marker, dynamic ETA, status timeline, reconnect-safe).
