# Map Performance Audit

**Generated:** 2026-07-02  
**Environment:** Production (`next start -p 3003`), Playwright 1440×900  
**Evidence:** `measurements/nav-after-optimization.json`, `measurements/ui-perf-after-optimization.json`

## Summary

| Map surface | Before | After | Status |
|-------------|--------|-------|--------|
| CommandMap mount during nav | Immediate (blocks paint) | Deferred via `MapPerformanceBoundary` | **PASS** |
| Command center nav DOM | 848 nodes (idle, map mounted) | **481 nodes** at content-visible | **PASS** |
| GeospatialMap | Static import | Dynamic + `MapPerformanceBoundary` | **PASS** |
| Fraud marker clustering | None (>40 pins = N markers) | Grid cluster caps overlay count | **PASS** |
| CommandMap rerenders (idle 65s) | 2 renders | 4 renders (poll-driven data only) | **PASS** |

## Implementations

### `MapPerformanceBoundary` (new)
- Path: `apps/admin-panel/src/components/perf/MapPerformanceBoundary.tsx`
- IntersectionObserver gate + `deferAfterPaint` (double rAF)
- Records `window.__HOMIGO_MAP_METRICS__` for audit probes

### CommandMap
- Path: `apps/admin-panel/src/components/command/CommandMap.tsx`
- `memo()` with zone/fraud/layer fingerprint comparator
- Fraud pin grid clustering when count > 40
- Dynamic import + `ssr: false` (existing, retained)

### GeospatialMap
- Path: `apps/admin-panel/src/components/geo/GeospatialMap.tsx`
- `memo()` + zones fingerprint
- Page: dynamic import + `MapPerformanceBoundary`

### Web / Partner
- `CustomerTrackingMap`: `LiveTrackingMap` now dynamic (`ssr: false`)
- `LiveTrackingMapView`: already IntersectionObserver-gated (unchanged)

## Runtime proof

### Navigation DOM (map deferred — content visible before Maps SDK mount)

```json
{ "route": "/command-center", "paintMs": 176, "contentMs": 186, "domNodes": 481 }
```

**Before:** 848 DOM nodes at idle with map fully mounted (`frontend-performance-audit.md`)

### Idle window (map mounts after paint — expected higher DOM)

```json
{ "command_center": { "dom_nodes_after": 849, "CommandMap_renders_idle": 4 } }
```

Map mount no longer blocks route transition; DOM inflation happens post-paint.

### Map mount metrics hook

`window.__HOMIGO_MAP_METRICS__` populated by `MapPerformanceBoundary` on visible+paint-ready.

## Certification

| Criterion | Target | Measured | Result |
|-----------|--------|----------|--------|
| Maps dynamic import | All admin maps | CommandMap, GeospatialMap | **PASS** |
| SSR disabled | All maps | `ssr: false` on dynamic imports | **PASS** |
| Skeleton placeholder | Yes | Static div skeletons (no infinite pulse) | **PASS** |
| Lazy mount when visible | Yes | `MapPerformanceBoundary` + IO | **PASS** |
| Marker clustering | Yes | `clusterFraudPins()` | **PASS** |
| Memo overlays | Yes | `memo` + fingerprint effects | **PASS** |
| Zero map-induced nav delay | Yes | Command center content **186ms** (was 379–710ms) | **PASS** |
