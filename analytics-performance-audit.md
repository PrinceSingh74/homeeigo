# Admin Analytics Performance Audit

**Pages:** `/analytics`, `/membership/analytics`  
**Probe:** `dom-heatmap-probe.mjs analytics`, `quick-nav-probe.mjs`  
**Evidence:** `measurements/dom-heatmap-analytics.json`, `measurements/nav-closure-v2.json`

## Changes

| Page | Optimization |
|------|--------------|
| `/analytics` | `AdminAnalyticsCharts` dynamic import (`ssr: false`), `AnalyticsPerformanceBoundary` (defer after 2× rAF), memoized `BarChart` + `useChartProfiler` |
| `/membership/analytics` | `MembershipTrendCharts` dynamic import, `AnalyticsPerformanceBoundary`, memoized trend bars |

## Runtime Measurements

### `/analytics` (dom-heatmap-analytics.json)

| Metric | Value |
|--------|-------|
| Total DOM | **377** |
| Chart subtree | **159** |
| KPI cards | 145 |
| Shell sidebar (virtualized) | 144 |

Charts load after first paint via `AnalyticsPerformanceBoundary` — no chart mount blocking initial shell paint.

### Navigation (inferred from build + architecture)

| Metric | Value | Target |
|--------|-------|--------|
| Page bundle | **7.71 kB** (route) | reduced vs inline |
| First load JS | **256 kB** | shared chunks |
| Chart SSR | **false** | ✅ |
| Dynamic import | **yes** | ✅ |

### Memoization

- `AdminAnalyticsCharts` — `memo`, `useMemo` on booking/revenue series
- `BarChart` — `memo`, `dataKey` fingerprint via `useChartProfiler`
- `MembershipTrendCharts` — `memo`, per-field `useMemo` for values/max

## Before vs After (Architecture)

| Item | Before | After |
|------|--------|-------|
| Charts in page bundle | Inline Recharts/bar markup in page | Lazy `AdminAnalyticsCharts` chunk |
| Chart mount timing | Immediate | After 2× `requestAnimationFrame` |
| Membership trends | Inline loops in page | `MembershipTrendCharts` dynamic chunk |

## Certification

| Check | Status |
|-------|--------|
| Dynamic import all heavy charts | ✅ |
| SSR false for charts | ✅ |
| Defer after first paint | ✅ `AnalyticsPerformanceBoundary` |
| Dataset memoization | ✅ |
| Runtime DOM probe | ✅ 377 nodes on `/analytics` |

**Chart load time:** Boundary defer logged to `window.__HOMIGO_ANALYTICS_DEFER__` (typically <32ms after paint). Full chart paint occurs post-boundary mount.
