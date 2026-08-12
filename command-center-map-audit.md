# Command Center Map DOM Audit

**Probe:** `ui-perf-probe.mjs command-center`, `dom-heatmap-probe.mjs command-center`  
**Evidence:** `measurements/ui-perf-command-center-closure-v2.json`, `measurements/dom-heatmap-command-center-v2.json`, `measurements/nav-closure-v2.json`

## Before vs After

| Metric | Before (v2) | After (closure v2) | Target | Status |
|--------|-------------|--------------------|--------|--------|
| Nav DOM (map loading) | 481 | **385** | <450 | ✅ PASS |
| Pre-map idle DOM | — | **353** | — | ✅ |
| Post-map total DOM | **849** | **690** | — | ⚠️ Google SDK |
| Google map subtree (`.gm-style` etc.) | ~400+ | **391** | isolated | ⚠️ external |
| React DOM (nav, no tiles) | ~481 | **~299** (690−391) | <450 | ✅ PASS |
| Content visible | 139ms | **167ms** | <300ms | ✅ PASS |
| Navigation paint | 87–170ms | **123ms** | <200ms | ✅ PASS |
| Geo-intel idle renders (20s) | 5–6 | **5** (page) + 4 (map) | expected | ✅ |

## React vs Google DOM (Runtime)

From `dom-heatmap-command-center-v2.json` after map mount:

| Layer | Nodes |
|-------|-------|
| **Total DOM** | 692 |
| **Map subtree** (`.gm-style`, isolation boundary) | **391** |
| **React DOM (estimated)** | **~301** |

Early snapshot (`__HOMIGO_MAP_DOM__` at 800ms, before tiles fully injected):

```json
{ "label": "CommandMap", "totalDom": 460, "mapSubtree": 3, "reactDom": 457 }
```

Tiles inflate asynchronously; 20s idle probe captures full Google DOM (**391 map nodes**).

## Architecture

1. **`MapDOMIsolationBoundary`** — wraps `CommandMap`, records `window.__HOMIGO_MAP_DOM__`.
2. **`MapPerformanceBoundary`** — IO visibility + defer-after-paint before map mount.
3. **Dynamic `CommandMap`** — `ssr: false`, memoized, clustered fraud pins (>40).
4. **Virtualized sidebar** — reduces shell overhead on all routes.

## Render Counts (20s idle window)

```json
"react_render_counts_idle_window": {
  "CommandCenterPage": 5,
  "AiIntelligencePanel": 4,
  "OperationalTimeline": 2,
  "CommandMap": 4
}
```

Geo-intel polling drives 5–6 page renders — within expected range for live data.

## Certification

| Check | Result |
|-------|--------|
| React DOM at navigation <450 | ✅ **385 nodes** |
| Map DOM isolated & measured | ✅ **391 nodes** in map subtree |
| Total DOM with Google tiles | ⚠️ **690** (SDK inflation, not React-controllable) |
| Nav/content paint targets | ✅ PASS |

**Note:** Total idle DOM including Google Maps tiles remains >450. React-owned DOM is contained and measured separately.
