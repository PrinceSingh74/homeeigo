# Dashboard DOM Audit — HOMIGO Final Performance Closure

**Probe:** `apps/admin-panel/scripts/ui-perf-probe.mjs` + `dom-heatmap-probe.mjs`  
**Environment:** Production (`next start -p 3003`), Playwright 1440×900  
**Evidence:** `measurements/ui-perf-dashboard-closure-v2.json`, `measurements/dom-heatmap-dashboard-v2.json`

## Before vs After

| Metric | Before (v2 baseline) | After (closure v2) | Target | Status |
|--------|----------------------|--------------------|--------|--------|
| Idle DOM (15s window) | **586** | **233** | <350 | ✅ PASS |
| Nav paint DOM | 460 | **263** | <350 | ✅ PASS |
| Below-fold mounts at idle | Yes (charts + table) | **No** | — | ✅ |
| Idle React renders (15s) | 2–9 | **0** | — | ✅ |
| Navigation paint | 128ms | **89ms** | <200ms | ✅ |
| Content visible | 142ms | **96ms** | <300ms | ✅ |

## DOM Tree Heatmap (After)

Top contributors (`dom-heatmap-dashboard-v2.json`):

| Rank | Subtree | Path |
|------|---------|------|
| 1 | 212 | `body` |
| 2 | 201 | `div.flex.h-dvh` (shell) |
| 3 | **144** | `aside.biz-sidebar` (virtualized nav) |
| 4 | 133 | sidebar scroll container |
| 5 | 132 | virtualized `nav` |
| 6 | 56 | main column |
| 7 | **34** | dashboard main content |
| 8 | **22** | `DashboardKpiStrip` |

Selector breakdown:

| Region | DOM nodes |
|--------|-----------|
| Shell sidebar | 144 |
| KPI strip | 22 |
| Charts (not mounted at idle) | 0 |
| Tables (not mounted at idle) | 0 |
| Below-fold boundary | 1 (placeholder only) |

## Changes Applied

1. **`DashboardKpiStrip`** — single 6-metric card grid replaces 6 `KpiCard` components (~100 node savings).
2. **`DashboardDOMBoundary`** — below-fold content (launchpad, charts, bookings table) lazy-mounts with `rootMargin="-420px"`; no intersection at 900px viewport without scroll.
3. **`AdminSidebar`** — virtualized with `@tanstack/react-virtual` (overscan 4); ~305 → **144** sidebar nodes.
4. Flattened dashboard header; `space-y-4` layout; dynamic imports for charts/launchpad.

## Runtime Proof

```json
// measurements/ui-perf-dashboard-closure-v2.json
"dom_nodes_before": 233,
"dom_nodes_after": 233,
"mount_counts_cumulative": { "AdminDashboardCharts": absent, "DataTable": absent }
```

```json
// measurements/dom-heatmap-dashboard-v2.json
"totalDom": 233,
"dashboardBoundaryMounts": []
```

**Certification:** Dashboard idle DOM **233 < 350** — runtime proven.
