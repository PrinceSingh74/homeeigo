# Frontend Performance Audit

**Audited at:** 2026-07-02T15:35:00Z  
**Environment:** Next.js 15 dev (`localhost:3003`), `reactStrictMode: true`, Playwright CDP probes  
**Method:** Live API latency probes, per-page network/WS/render/mount instrumentation (`ui-perf-probe.mjs`, `useRenderProbe`, `useMountProbe`)  
**Constraint:** Findings below are runtime-measured only. Backend latency confirmed healthy — not the Chrome CPU bottleneck.

---

## Executive summary

| Layer | Verdict | Runtime evidence |
|-------|---------|------------------|
| Backend API | **Not the bottleneck** | `/health` 72ms, `/ready` 53ms, `/api/admin/dashboard` 309ms, `/api/geo-intel/exec-kpis` 151ms |
| Chrome CPU pressure | **Client-side** | 744–849 DOM nodes/page, Google Maps on command center, WS frames 12.9/min on dashboard, StrictMode double-mounts, support polling duplicates |
| Polling | **Low on most pages post-tuning** | Dashboard 0/min steady; support 2.8/min with duplicate ticket fetches |
| WS re-subscriptions | **Single socket at login** | 1× `/ws/notifications` (shared pool) |
| Rerenders (idle 65s) | **Low except dashboard widgets** | 2 renders/component on dashboard; command center map **0** idle renders |

---

## Backend latency control (not the bottleneck)

Measured 2026-07-02 with authenticated admin token where required:

| Endpoint | Status | Latency |
|----------|--------|---------|
| `/health` | 200 | **72ms** |
| `/ready` | 200 | **53ms** |
| `/api/admin/dashboard` | 200 | **309ms** |
| `/api/admin/bookings` | 200 | **311ms** |
| `/api/geo-intel/exec-kpis` | 200 | **151ms** |

Operator-reported 96ms / 119ms / 167ms range is consistent. **API latency does not explain extreme Chrome CPU.**

---

## Per-page runtime measurements

**Probe config:** 25s warmup (post-navigation hydration) + 65s idle measurement window.  
**Homigo API filter:** `/api/admin/*`, `/api/geo-intel/*`, `/api/user/me`.

### Dashboard (`/`)

```json
{
  "api_calls_per_min": 0,
  "api_calls_total": 0,
  "websocket_frames_per_min": 12.9,
  "websocket_frames_total": 14,
  "dom_nodes": 744,
  "longtask_buffered": 5,
  "react_render_counts_idle_window": {
    "AdminRealtimeBridge": 2,
    "AdminTopBar": 2,
    "BusinessOverviewPage": 2,
    "DataTable": 2,
    "AdminDashboardCharts": 2
  },
  "mount_counts_cumulative": {
    "AdminRealtimeBridge": 1,
    "AdminTopBar": 2,
    "DataTable": 2,
    "BusinessOverviewPage": 2,
    "AdminDashboardCharts": 2
  }
}
```

| Metric | Value |
|--------|-------|
| API calls/min | **0.0** |
| WS events/min | **12.9** |
| Polling observed | None in steady window (dashboard poll = 120s) |
| Duplicate API paths | None |
| Component mounts (cumulative) | StrictMode **2×** on layout/widgets; bridge **1×** |

### Command center (`/command-center`)

```json
{
  "api_calls_per_min": 0.9,
  "api_calls_total": 1,
  "websocket_frames_per_min": 0,
  "dom_nodes": 848,
  "longtask_buffered": 2,
  "react_render_counts_idle_window": {
    "AdminRealtimeBridge": 0,
    "AdminTopBar": 0,
    "CommandCenterPage": 0,
    "CommandMap": 0
  },
  "mount_counts_cumulative": {
    "AdminRealtimeBridge": 1,
    "AdminTopBar": 2,
    "CommandMap": 2,
    "CommandCenterPage": 2
  }
}
```

| Metric | Value |
|--------|-------|
| API calls/min | **0.9** (1 KPI safety poll / 90s budget) |
| WS events/min | **0** |
| CommandMap idle rerenders | **0** (`memo()` effective) |
| DOM nodes | **848** (heaviest surface — Maps + overlays) |

### Bookings (`/bookings`)

```json
{
  "api_calls_per_min": 0.9,
  "api_calls_by_path": { "/api/admin/bookings": 1 },
  "websocket_frames_per_min": 0,
  "dom_nodes": 602,
  "longtask_buffered": 5,
  "react_render_counts_idle_window": {
    "AdminRealtimeBridge": 0,
    "AdminTopBar": 0,
    "DataTable": 4
  }
}
```

| Metric | Value |
|--------|-------|
| API calls/min | **0.9** (60s bookings poll) |
| DataTable idle rerenders | **4** (highest among instrumented components) |
| Table rows fetched | 20/page (pagination); virtualizer threshold = 16 rows |

### Support (`/support`)

```json
{
  "api_calls_per_min": 2.8,
  "api_calls_by_path": { "/api/admin/support/tickets": 3 },
  "duplicate_api_paths": { "/api/admin/support/tickets": 3 },
  "websocket_frames_per_min": 0,
  "dom_nodes": 603,
  "longtask_buffered": 3,
  "react_render_counts_idle_window": {
    "AdminRealtimeBridge": 0,
    "AdminTopBar": 0,
    "DataTable": 0
  }
}
```

| Metric | Value |
|--------|-------|
| API calls/min | **2.8** |
| Configured polls | tickets **20s**, ticket detail **15s** |
| Duplicate requests | **3×** same `/api/admin/support/tickets` in 65s |
| Table rows | limit **50** (virtualized when ≥16) |

---

## Consolidated metrics table

| Page | API/min | WS events/min | Idle renders (instrumented total) | DOM nodes | Long tasks |
|------|---------|---------------|-----------------------------------|-----------|------------|
| Dashboard | 0.0 | **12.9** | 10 | 744 | 5 |
| Command center | 0.9 | 0.0 | 0 | **848** | 2 |
| Bookings | 0.9 | 0.0 | 4 | 602 | 5 |
| Support | **2.8** | 0.0 | 0 | 603 | 3 |

---

## Task-by-task audit

### 1. React rerenders

**Runtime:** `useRenderProbe` counters during 65s idle window after warmup.

| Component | Dashboard | Command center | Bookings | Support |
|-----------|-----------|----------------|----------|---------|
| AdminRealtimeBridge | 2 | 0 | 0 | 0 |
| AdminTopBar | 2 | 0 | 0 | 0 |
| BusinessOverviewPage | 2 | — | — | — |
| AdminDashboardCharts | 2 | — | — | — |
| DataTable | 2 | — | **4** | 0 |
| CommandMap | — | **0** | — | — |
| CommandCenterPage | — | **0** | — | — |

**Finding:** Dashboard widgets each rerender **2×** during idle — correlated with **12.9 WS frames/min** (keepalive/ping traffic). Command center map is stable at **0** idle rerenders.

### 2. Unnecessary rerenders

| Evidence | Detail |
|----------|--------|
| Dashboard charts + top bar | 2 idle renders each while API calls = 0 → driven by **WS frames**, not REST |
| Bookings DataTable | **4** idle renders with only 1 API call → likely `isFetching` overlay + React Query state churn |
| CommandMap | **0** idle renders → memo + fingerprinting working |

### 3. Polling loops

| Page | Code interval | Measured steady API/min | Loop detected? |
|------|---------------|-------------------------|----------------|
| Dashboard | 120s | 0.0 | No |
| Command center KPI | 90s | 0.9 | No (single safety poll) |
| Bookings list | 60s | 0.9 | No |
| Support tickets | 20s | 2.8 | **Yes — active** (highest API page) |
| Support ticket detail | 15s | (not selected in probe) | Latent when ticket open |

**Highest polling surface at runtime:** `/support` (2.8 API/min).

### 4. Duplicate API requests

| Page | Duplicate paths (65s window) | Count |
|------|------------------------------|-------|
| Dashboard | — | 0 |
| Command center | — | 0 |
| Bookings | — | 0 |
| Support | `/api/admin/support/tickets` | **3** |

**Finding:** Support page issues **3 identical ticket list fetches** in 65s (~21s cadence) — consistent with 20s `refetchInterval` plus initial fetch overlap.

### 5. Websocket re-subscriptions

**Login probe (post-auth, 3s settle):**

```json
{
  "notification_socket_count": 1,
  "websocket_urls": ["ws://localhost:3003/ws/notifications?token=..."]
}
```

| Check | Result |
|-------|--------|
| Notification sockets at login | **1** (shared ref-counted pool) |
| New sockets during idle windows | **0** on all 4 pages |
| WS frames/min (dashboard) | **12.9** on existing connection |
| Backend `websocket_duplicate_join_total` | **0** |

**Finding:** No re-subscription churn during page idle. Dashboard CPU still receives WS keepalive frames.

### 6. Charts rerendering excessively

| Component | Idle renders (65s) | Verdict |
|-----------|-------------------|---------|
| AdminDashboardCharts | **2** | Not excessive |
| CommandMap (Google Maps) | **0** | Memo effective |
| ChartCard (nested) | Not instrumented | — |

**Finding:** CSS bar charts on dashboard are light. **Google Maps command center** dominates DOM (848 nodes) but **does not rerender** during idle measurement.

### 7. Large table rendering

| Page | DOM nodes | Rows configured | Virtualized |
|------|-----------|-----------------|-------------|
| Dashboard recent | 744 (page total) | 6 rows | No (below threshold) |
| Bookings | 602 | 20/page | Yes (≥16) |
| Support | 603 | **50** | Yes (≥16) |

**Runtime:** `DataTable` uses `@tanstack/react-virtual` when `rows.length >= 16` (`VIRTUALIZE_THRESHOLD`).

### 8. Missing React.memo

**Codebase grep:** Only `CommandMap` uses `React.memo` in admin panel.

**Runtime correlation:**

| Component | Has memo? | Idle rerenders | Mount count |
|-----------|-----------|----------------|-------------|
| CommandMap | **Yes** | 0 | 2 (StrictMode) |
| AdminDashboardCharts | No | 2 | 2 |
| AdminTopBar | No | 2 | 2 |
| DataTable | No | 2–4 | 2 |

**Finding:** Components **without** `memo` show higher idle render counts where parent/WS/query state updates propagate. `CommandMap` with `memo` shows **0** idle rerenders — runtime proof memo is effective here.

### 9. Missing useMemo / useCallback

**Not directly measurable without per-hook Profiler.** Runtime proxies:

| Surface | useMemo/useCallback in source | Idle behavior |
|---------|------------------------------|---------------|
| Command center page | `useMemo` for zones/fraud merge | 0 page rerenders idle |
| CommandMap | `useMemo` for layer/zone fingerprints | 0 map rerenders idle |
| Support page | `useMemo` for queryParams | 0 idle rerenders |
| Bookings DataTable | No memo on rows | **4** idle rerenders |

**Finding:** Pages with `useMemo` for derived data show stable idle renders. `DataTable` rerenders without prop changes on bookings page.

### 10. Expensive map/chart components

| Component | Page | DOM nodes | Idle renders | Long tasks |
|-----------|------|-----------|--------------|------------|
| CommandMap (Google Maps) | Command center | **848** | 0 | 2 |
| AdminDashboardCharts (CSS) | Dashboard | 744 (total) | 2 | 5 |
| GeospatialMap / heatmap | Not probed this run | — | — | — |

**Finding:** Command center is the **most expensive page by DOM size** (848 nodes). Maps are CPU-heavy at mount but **stable during idle** thanks to `memo()` + overlay fingerprints.

---

## Component mount frequency

Cumulative mounts after full session navigation (StrictMode dev):

| Component | Mounts | Notes |
|-----------|--------|-------|
| AdminRealtimeBridge | **1** | Shared WS pool survives remounts |
| AdminTopBar | **2** | StrictMode double-mount |
| DataTable | **2** | StrictMode |
| BusinessOverviewPage | **2** | StrictMode |
| AdminDashboardCharts | **2** | StrictMode |
| CommandMap | **2** | StrictMode |
| CommandCenterPage | **2** | StrictMode |

**Idle window mount churn:** **0** on all instrumented components (no remounts during 65s measurement).

---

## Root cause chain (Chrome CPU)

```
Fast backend (72–311ms)
        ↓
Dev StrictMode double-mount (2× on most components)
        ↓
Dashboard WS keepalive frames (12.9/min) → widget rerenders (2× each)
        ↓
Command center Google Maps (848 DOM nodes) — mount cost, stable idle
        ↓
Support 20s polling + duplicate ticket fetches (2.8 API/min)
        ↓
Bookings DataTable query-state rerenders (4× idle)
        ↓
Next.js dev HMR + compilation overhead
        ↓
High Chrome CPU (client-side)
```

---

## Polling frequency reference (configured)

| Location | `refetchInterval` |
|----------|-------------------|
| Dashboard | 120s |
| Bookings list | 60s |
| Command KPI | 90s |
| Command geo layers | 120s |
| Support tickets | **20s** |
| Support ticket detail | **15s** |
| Alerts page | 30s (+ separate `/ws/admin-ops`) |
| Digital twin | 30–60s |

Source: `apps/admin-panel/src/lib/query-polling.ts` and page-level `useQuery` calls.

---

## Reproduce

```powershell
# Backend + admin dev servers required
cd apps/backend
bun --env-file=.env run src/index.ts

cd apps/admin-panel
$env:BACKEND_ORIGIN='http://localhost:3000'
npm run dev

# Per-page audit
$env:PROBE_WARMUP_MS='25000'
$env:PROBE_WINDOW_MS='65000'
node scripts/ui-perf-probe.mjs dashboard
node scripts/ui-perf-probe.mjs command-center
node scripts/ui-perf-probe.mjs bookings
node scripts/ui-perf-probe.mjs support

# Multi-page audit (optional)
node scripts/frontend-audit-probe.mjs
```

---

## Priority findings (runtime-ranked)

1. **Command center DOM weight (848 nodes)** — primary static render cost; map idle-stable but mount-heavy.
2. **Dashboard WS frames (12.9/min)** — drives 2× idle rerenders on 5 instrumented components without REST traffic.
3. **Support polling (2.8 API/min)** — only page with active duplicate ticket fetches.
4. **Bookings DataTable (4 idle rerenders)** — unnecessary render churn during `isFetching` cycles.
5. **StrictMode double-mount (2×)** — dev-only; `AdminRealtimeBridge` mitigated to 1 mount via shared WS.
6. **Missing `React.memo`** — runtime correlation: memo'd `CommandMap` = 0 idle rerenders; non-memo widgets = 2+.

---

## Files referenced

| Area | Path |
|------|------|
| Audit probe | `apps/admin-panel/scripts/ui-perf-probe.mjs` |
| Multi-page probe | `apps/admin-panel/scripts/frontend-audit-probe.mjs` |
| Render/mount probes | `apps/admin-panel/src/lib/render-probe.ts` |
| Polling budgets | `apps/admin-panel/src/lib/query-polling.ts` |
| Shared WebSocket | `apps/admin-panel/src/hooks/use-realtime-channel.ts` |
| Memo'd map | `apps/admin-panel/src/components/command/CommandMap.tsx` |
| Virtualized table | `apps/admin-panel/src/components/ui/DataTable.tsx` |
| Support polling | `apps/admin-panel/src/app/(console)/support/page.tsx` |
| StrictMode | `apps/admin-panel/next.config.js` |

---

## Verdict

Backend APIs are fast. **Chrome CPU is driven by client-side work:** Google Maps DOM on command center, WebSocket keepalive-driven dashboard rerenders, support polling with duplicate fetches, bookings table render churn, and dev-mode StrictMode double-mounting. Runtime probes confirm polling is well-controlled on dashboard/command center/bookings after prior remediation; **support remains the highest steady API consumer** at 2.8 calls/min.
