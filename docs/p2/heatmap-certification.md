# Phase 16.4 — Demand/Supply Heatmap Certification

**Date:** 2026-06-13 · execution-only. **Float-grid aggregation computed on read** — NO PostGIS, NO materialized view, NO new table. Aggregates existing `bookings ⋈ addresses` (demand / revenue / cancellation) and `providers ⋈ locations` (supply) into square grid cells.

## Service (`heatmap.service.ts`)
`generate({ gridSize?, days?, bbox? })` → per-cell `{ lat, lng, demand, completed, cancelled, cancellationRate, revenue, supplyOnline, supplyTotal, demandScore (0–100), supplyGap }` + totals. Grid sizes 0.01–0.1 (~1–11 km), default 0.05; window default 30 d (max 365); optional bounding box. Two parameterised raw aggregations (grid via `floor(lat/size)*size`).

## Route
- `GET /api/admin/heatmap?gridSize=&days=&minLat=&maxLat=&minLng=&maxLng=` — **RBAC-gated** (`/api/admin` plugin → 401 without admin ✅).

## Execution evidence (live `homigo_db`, read-only)
```
gridSize=0.05 days=365 cells=5 totalDemand=94 totalRevenue=₹32,380 onlineSupply=2 | 73 ms
  (28.5,77.2)  demand=52 score=100 supplyOnline=0 gap=52  revenue=₹24,841 cancelRate=0.73
  (28.6,77.35) demand=23 score=44  supplyOnline=2 gap=21  revenue=₹500
  (28.4,77.0)  demand=14 score=27  supplyOnline=0 gap=14  revenue=₹6,489
```
- Real demand/supply/revenue/cancellation surfaced; the busiest cell (Delhi/Saket, 52 bookings) shows **online supply 0 → supplyGap 52** (an actionable under-served zone).
- **Latency 73 ms** (target < 200 ms for geo lookups) ✅.

## RULE / criteria
- TypeScript clean ✅ · no new tables / no PostGIS / no duplicate analytics ✅ · reuses existing booking/address/provider/location data ✅ · RBAC-gated ✅ · sub-200 ms ✅.

**Verdict: 16.4 PRODUCTION-READY.** Admin map UI can render these cells directly (lat/lng/demandScore/supplyGap). Rollback: `git checkout -- src/services/heatmap.service.ts src/routes/admin.ts`.
