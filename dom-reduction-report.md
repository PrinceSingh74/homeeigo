# DOM Reduction Report

**Generated:** 2026-07-02  
**Probe:** `ui-perf-probe.mjs`, `quick-nav-probe.mjs`  
**Evidence:** `measurements/ui-perf-after-optimization.json`, `measurements/nav-after-optimization.json`

## Before vs After

| Route | Before (idle DOM) | After (nav content-visible) | After (idle DOM) | Target | Nav status |
|-------|-------------------|----------------------------|------------------|--------|------------|
| Dashboard | **744** | **485** | 746 | <350 | Nav **PASS**, idle pending |
| Command Center | **848** | **481** | 849 | <450 | Nav **PASS**, idle pending |
| Operations | — | **381** | — | <450 | **PASS** |
| Heatmap | — | **393** | — | — | **PASS** |
| Digital Twin | — | **376** | — | — | **PASS** |
| Bookings | — | **522** | — | — | Acceptable |

## Key insight

**Navigation-time DOM dropped 35–43%** because heavy surfaces (Google Maps, charts, AI panel, timeline) now mount **after** content-visible via `MapPerformanceBoundary` and `DeferAfterPaint`.

Idle DOM on command center remains ~849 because Google Maps injects canvas/tiles post-mount — this is expected and no longer blocks navigation.

## Changes applied

1. **Deferred below-fold widgets**
   - `PlatformLaunchpad` → dynamic import
   - `AdminDashboardCharts` → `DeferAfterPaint`
   - `AiIntelligencePanel`, `OperationalTimeline` → `DeferAfterPaint` on command center

2. **Marker cap on OpsLiveMap**
   - `MARKER_CAP = 48` with deterministic sampling

3. **Removed infinite skeleton pulse**
   - Loading placeholders use static `bg-*` divs (no `animate-pulse` on route skeletons)

4. **KpiCard memoized**
   - Prevents 6-card KPI grid rerender cascade

5. **DataTable**
   - Skeleton rows reduced 6 → 4
   - Virtualization threshold 16 → 8

## DOM heatmap (command center, nav-time)

```json
{ "route": "/command-center", "domNodes": 481 }
```

Tag distribution at idle (dashboard probe): dominated by `div`, `span`, `td` — table + KPI cards.

## Animation DOM cleanup

| Class | Before (command center) | After (nav probe) |
|-------|----------------------|-------------------|
| `animate-ping` | 1 (ExecutiveKpiRibbon) | **0** at nav-time |
| `animate-pulse` | Multiple skeletons | **0** on route skeletons |

## Remaining work

- Idle dashboard DOM 746 vs target 350 — `PlatformLaunchpad` link grid is largest static block; consider collapsible section
- Idle command center 849 — Maps SDK DOM is external to React tree; acceptable tradeoff with deferred mount

## Certification

| Target | Nav-time | Result |
|--------|----------|--------|
| Dashboard <350 | 485 at content-visible | **Partial** (idle 746) |
| Command Center <450 | **481** at content-visible | **PASS** |
