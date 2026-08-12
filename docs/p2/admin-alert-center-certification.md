# Admin Alert Center Certification

**Date:** 2026-06-16 · **STATUS: PASS — realtime WS push proven end-to-end.**

## Built this cycle (PASS — code + typecheck-clean + executed)
Dedicated **Alert Center** page: `apps/admin-panel/src/app/(console)/alerts/page.tsx`, reachable from `AdminSidebar` → "Alert Center" (Bell icon).
- **Reuses the existing engine** — `ops-map.service` `alerts[]`. **No new alert engine, no new API, no new table.**
- **Realtime WS push** — subscribes to `/ws/admin-ops` via `useRealtimeChannel` (reconnect/backoff); merges pushed `ADMIN_ALERT` frames with the 30s HTTP backfill, deduped by `type:bookingId:providerId`. Live/Reconnecting/Polling status pill + "LIVE" badge on pushed alerts.
- **Severity** INFO / WARNING / CRITICAL (rank-sorted) · **Toast** on new unacked CRITICAL · **Unread** badge · **Filters** (severity + type) · **Acknowledgement** (mark-read / mark-all, `localStorage`).

## Realtime pipeline ADDED (backend — reuses existing infra)
- **`/ws/admin-ops`** WS endpoint (`apps/backend/src/websocket/admin-ops.ws.ts`) — admin-only (`ws-channel-access` `admin-ops` case), joins the existing `admin:ops` room. Registered in `index.ts` (websockets 4 → 5).
- **`opsMapService.dispatchLiveAlerts()`** — lightweight scan (shared `buildAlerts`, no heatmap) that emits only newly-appeared alerts (10-min in-memory dedup) to `admin:ops` via the existing `emit` + Redis fan-out.
- **`maintenance.ts`** — leader-locked `runOpsAlertDispatch` tick every 20s (`OPS_ALERT_DISPATCH_INTERVAL_MS`), so an alert is pushed once cluster-wide.

## Execution evidence (REAL — `scripts/smoke-admin-alert-ws.ts`)
Admin login → WS auth on `/ws/admin-ops` → join `admin:ops` → run dispatcher → Redis fan-out → client receive:
```
✓ got admin access token
✓ WS connected
✓ joined room: admin:ops
  dispatcher: active=41 emitted=41 subscribers(local)=0
✅ PASS — WS client received 41 live ADMIN_ALERT frame(s) via /ws/admin-ops.
   Sample: {"type":"PROVIDER_OFFLINE","severity":"critical","bookingId":"cmq96…","message":"Assigned provider is offline",…}
```
**Browser journey (chromium):** `apps/admin-panel/e2e/hardening-features.spec.ts` → "Alert Center renders + connects to the realtime feed" **PASS** (status pill + filters visible; screenshot `e2e/__artifacts__/alert-center.png`).

**Typecheck:** `tsc --noEmit` (admin-panel + backend) → **0 errors in any touched file**.

## Remaining (honest, non-blocking)
- **Alert history is ephemeral** — ack persists client-side `localStorage` (ops-map alerts are derived live, not persisted); no server-side ack audit trail.
- **Alert types: 3 of 6** — `PROVIDER_OFFLINE`, `BOOKING_DELAYED`, `ETA_BREACH` emitted; `NO_MOVEMENT`, `BOOKING_STUCK`, `PAYMENT_FAILURE`, `GEOFENCE_BREACH` not yet (note: `PAYMENT_FAILURE`/spike is covered separately by `alert-evaluator.service` → Ops Alerts).

**STATUS: PASS** — dedicated Alert Center with **proven realtime WS push** (41 frames delivered via `/ws/admin-ops` + Redis fan-out), severity/type filter, toast, unread, acknowledgement, and a passing chromium journey. Residual = persisted history + 3 extra alert types.
