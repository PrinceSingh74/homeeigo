# HOMIGO Admin Command Center — Operations Control Tower

**Date:** 2026-06-20 · Built in the admin-panel, consuming ONLY the verified `/api/geo-intel/*`
endpoints (no business-logic recreation). Real runtime data only. `tsc` 0 errors, production build green.

> **Status: PASS.** Full-screen 4-region command center (KPI ribbon · India ops map · AI panel ·
> ops timeline) with 8 toggleable, simultaneously-stackable map layers — all backed by the live
> Geo-Intelligence APIs. Route: `/command-center` (admin sidebar → "Command Center").

---

## Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│ EXECUTIVE KPI RIBBON   (exec-kpis · 15s refresh · animated · color)    │
├─────────────────────────────────────────────────────┬──────────────────┤
│                                                     │  AI INTELLIGENCE │
│   LIVE INDIA OPERATIONS MAP (dark Google theme)     │  PANEL           │
│   layer bar: Density Demand Revenue Surge Fraud     │  • AI insights   │
│              Geofence Traffic Weather               │  • Surge         │
│   zone overlays (Circle/Marker) + Google Traffic    │  • Demand        │
│   fraud pins · zone/provider/fraud counts           │  • Revenue       │
│                                                     │  • Zone intel    │
│                                                     │  • Fraud         │
├─────────────────────────────────────────────────────┴──────────────────┤
│ OPERATIONAL TIMELINE  (live fraud teleports + active surge zones)       │
└──────────────────────────────────────────────────────────────────────┘
```

## Components (`apps/admin-panel/src/components/command/`)
| Component | Consumes | Renders |
|-----------|----------|---------|
| `ExecutiveKpiRibbon` | `exec-kpis` | GMV, orders today, completion/cancellation/refund %, online providers, active customers — rAF count-up, health-colored, freshness+confidence |
| `CommandMap` | `provider-density` (positions) + `zone-scoring` + `surge` + `fraud` | dark India map; 8 layers as Google Circle/Marker overlays joined by `zoneId`; real `TrafficLayer` |
| `AiIntelligencePanel` | `surge`, `demand-forecast`, `fraud`, `revenue-forecast`, `zone-scoring` | derived insights + per-domain command cards |
| `OperationalTimeline` | `fraud`, `surge` | chronological live-ops feed |
| `page.tsx` | all 7 | 4-region layout, react-query polling, layer-toggle state, zone merge |

## Map layers (data provenance — all real)
| Layer | Source endpoint | Encoding |
|-------|-----------------|----------|
| Density | provider-density | blue circle, opacity ∝ providers/km² |
| Demand | zone-scoring (demandScore) | green→red heat |
| Revenue | zone-scoring (revenue24h) | green, opacity ∝ ₹ |
| Surge | surge (predictedSurge) | heat ring, size ∝ multiplier |
| Fraud | fraud (event lat/lng) | red warning pins |
| Geofence | provider-density (centerLat/Lng + areaKm2→radius) | cyan boundary |
| Traffic | **Google Maps TrafficLayer** | live congestion |
| Weather | surge (weatherSurge) | amber haze ∝ weather multiplier |

Layers stack simultaneously; toggled independently. Overlays are lightweight primitives
redrawn only on data/layer change — performant for the geofence count (zones, not per-provider).

## Runtime evidence
- Admin-panel `tsc` **0 errors**; `next build` green — `/command-center` 9.02 kB / 246 kB First Load, 55/55 pages.
- Live data verified through the same endpoints the UI calls (admin token):
  - exec-kpis → GMV ₹19,396 · completion 46.3% · 6 online · 172 customers (conf 0.99)
  - surge → NCR Gurugram ×3 (+400%) · provider-density → Delhi CP 0.01/km²
  - **fraud pins carry real coords** → `1465 km/h @ 28.470,77.060` · `5816 km/h @ 28.560,77.212`
  - zone-scoring / revenue-forecast / demand-forecast all live.
- RBAC enforced server-side (admin-only endpoints 403 for non-admin); admin-panel sits behind `AdminAuthGuard`.

## Honest scope notes
- **ETA layer** — `/eta` is point-to-point (not per-zone), so it is exposed via the AI panel /
  on-demand rather than as a zone heatmap; a per-zone ETA grid would need N zone-center calls
  (documented, easy follow-up).
- **Weather layer** uses the per-zone `weatherSurge` from `/surge` (real); a richer rain/AQI raster
  overlay needs a weather-tile source (interface ready).
- **Provider/booking *individual* animation** — the command center plots zone-level aggregates;
  per-provider live markers would consume a providers-stream endpoint (not in the 8 — future).
- No mock data, no placeholder KPIs anywhere.
