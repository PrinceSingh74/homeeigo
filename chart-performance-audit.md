# Chart Performance Audit

**Generated:** 2026-07-02  
**Evidence:** `ui-perf-probe.mjs dashboard`, production build manifest

## Summary

| Surface | Before | After | Status |
|---------|--------|-------|--------|
| Dashboard charts blocking route | Charts in initial render tree | `DeferAfterPaint` + dynamic import | **PASS** |
| Dashboard content visible | 710ms (dev, charts blocking) | **144ms** (prod probe) | **PASS** |
| AdminDashboardCharts idle renders | 5 (65s window) | **4** | **PASS** |
| Recharts animation CPU | Live draw animation | `isAnimationActive={false}` (partner) | **PASS** |
| Chart profiler | None | `useChartProfiler()` hook | **PASS** |

## Implementations

### Admin panel (CSS bar charts — no Recharts)
- `AdminDashboardCharts`: `memo`, `useMemo` datasets, `ChartCard` memoized
- `DeferAfterPaint` wrapper on dashboard page — charts load after first paint
- `useChartProfiler("AdminDashboardCharts", dataKey)` tracks render/skip counts

### Partner web (Recharts)
- `BarChartInner`: `memo`, `isAnimationActive={false}`, memoized axis config
- `PerformanceAnalytics`: all `Line`/`Bar` with `isAnimationActive={false}`
- `analytics/page.tsx`: dynamic import, `ssr: false`

## Runtime proof

### Dashboard navigation (charts deferred)

```json
{ "route": "/", "paintMs": 131, "contentMs": 144, "domNodes": 485 }
```

**Before:** Content visible **710ms** waiting for chart resolve (`frontend-navigation-audit.md`)

### Idle render counts (post-mount, 65s window)

```json
{
  "AdminDashboardCharts": 4,
  "BusinessOverviewPage": 2
}
```

### Production bundle (chart code split)

| Route | Page JS | First Load JS |
|-------|---------|---------------|
| `/` (dashboard) | 7.53 kB | 266 kB |
| `/command-center` | 8.84 kB | 249 kB |

Charts are in separate async chunks via `next/dynamic`.

## Certification

| Criterion | Result |
|-----------|--------|
| React.memo on charts | **PASS** |
| useMemo datasets | **PASS** |
| Dynamic import | **PASS** |
| Charts after first paint | **PASS** |
| No route-blocking chart draw | **PASS** (144ms dashboard content) |
| Chart profiler instrumented | **PASS** (`chart-profiler.ts`) |
