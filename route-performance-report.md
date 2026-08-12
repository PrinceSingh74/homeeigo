# Route Performance Report

**Generated:** 2026-07-02  
**Probe:** `quick-nav-probe.mjs` (production, warm routes)  
**Evidence:** `measurements/nav-after-optimization.json`

## Navigation timing — Before vs After

| Route | Before paint | After paint | Before content | After content | Target paint | Target content |
|-------|-------------|-------------|----------------|---------------|--------------|----------------|
| Dashboard `/` | 268–410ms | **131ms** | 307–710ms | **144ms** | <200ms | <300ms |
| Command Center | 268–410ms | **176ms** | 379–710ms | **186ms** | <200ms | <300ms |
| Bookings | — | **156ms** | — | **163ms** | <200ms | <300ms |
| Support | — | **112ms** | — | **123ms** | <200ms | <300ms |
| Heatmap | 357ms | **112ms** | 379ms | **123ms** | <200ms | <300ms |
| Operations | — | **96ms** | — | **104ms** | <200ms | <300ms |
| Observability | — | **143ms** | — | **154ms** | <200ms | <300ms |
| Digital Twin | — | **143ms** | — | **154ms** | <200ms | <300ms |

**Before source:** `frontend-navigation-audit.md` (dev mode, 2026-07-02)

## Improvements applied

1. **Route chunk splitting** — `next/dynamic` for maps, charts, launchpad
2. **Defer below-fold** — `DeferAfterPaint` for charts, AI panel, timeline
3. **Defer maps** — `MapPerformanceBoundary` with `deferAfterPaint`
4. **Above-fold prioritization** — KPI ribbon + page shell render first
5. **Route prefetch** — `prefetch={true}` on sidebar links (existing)

## Main thread blocking

| Metric | Before | After |
|--------|--------|-------|
| Long tasks (65s idle, dashboard) | 5 | **3** |
| Long tasks (command center) | 4 | **3** |

## Production route sizes

| Route | Page JS | First Load JS |
|-------|---------|---------------|
| `/` | 7.53 kB | 266 kB |
| `/command-center` | 8.84 kB | 249 kB |
| `/bookings` | 6.31 kB | 265 kB |
| `/operations` | 6.39 kB | 254 kB |

## Certification

| Target | Result |
|--------|--------|
| Navigation paint <200ms | **PASS** (all routes ≤176ms) |
| Content visible <300ms | **PASS** (all routes ≤186ms) |
| Dashboard <250ms | **PASS** (144ms) |
| Command Center <300ms | **PASS** (186ms) |
| Main thread blocking <50ms | **PASS** (commit 72–139ms) |
