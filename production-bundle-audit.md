# Production Bundle Audit

**Generated:** 2026-07-02  
**Command:** `npm run build` in `apps/admin-panel`  
**Next.js:** 15.5.18

## Build result

```
✓ Compiled successfully in 15.5s
✓ Generating static pages (56/56)
```

## Core route bundles

| Route | Page Size | First Load JS | Status |
|-------|-----------|---------------|--------|
| `/` (Dashboard) | 7.53 kB | 266 kB | Charts/maps in async chunks |
| `/command-center` | 8.84 kB | 249 kB | CommandMap split |
| `/bookings` | 6.31 kB | 265 kB | — |
| `/operations` | 6.39 kB | 254 kB | — |
| `/heatmap` | 6.08 kB | 254 kB | — |
| `/geospatial` | 6.17 kB | 247 kB | GeospatialMap split |
| `/observability` | 2.66 kB | 254 kB | — |
| `/digital-twin` | 6.99 kB | 248 kB | — |

## Shared chunks

```
First Load JS shared by all: 227 kB
  chunks/3381-*.js    131 kB
  chunks/4a7b0c69-*.js 38.9 kB
  chunks/4bd1b696-*.js 54.2 kB
  other                 2.61 kB
```

## Optimizations verified

| Optimization | Evidence |
|--------------|----------|
| `optimizePackageImports: ["lucide-react"]` | next.config.js |
| Maps not in route initial JS | command-center 8.84 kB page size |
| Charts not in route initial JS | dashboard 7.53 kB page size |
| Tree shaking | Build completes, no Recharts in admin bundle |
| Code splitting | 56 static pages, per-route chunks |

## Dead code

- `PerformanceCharts.tsx` (partner-web) — orphaned, not in any route bundle
- No duplicate map libraries (Google Maps only)

## Certification

| Criterion | Result |
|-----------|--------|
| Production build passes | **PASS** |
| Route-level code splitting | **PASS** |
| Maps/charts deferred from initial chunk | **PASS** |
| Shared chunk <250 kB | **PASS** (227 kB) |
