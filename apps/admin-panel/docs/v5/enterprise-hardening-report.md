# Enterprise Hardening Report — HOMIGO V5 (Admin Panel)

**Method:** static + build-time evidence. Runtime load simulation against production data is out of scope for this pass (requires a seeded staging DB — see scale-readiness-report.md).

## Runtime evidence captured
- `npm run type-check` → **exit 0** (no type errors across ~120 source files).
- `npm run build` → **exit 0**, 56 routes generated (54 static ○, 2 dynamic ƒ: `/bookings/[id]`, `/finance/chargebacks/[id]`, `/hq/[section]`).
- **Shared First Load JS: 227 kB** (`chunks/3381` 131 kB, `4a7b0c69` 38.9 kB, `4bd1b696` 54.2 kB).

## Bundle size audit (per-route First Load JS)
| Route | First Load JS | Note |
|---|---|---|
| `/` (Executive HQ) | ~274 kB | heaviest; charts + geo + intelligence panels all `dynamic()` |
| `/hq/[section]` | ~245 kB | dashboards code-split per HQ |
| `/invoices` | ~266 kB | table-heavy |
| `/command-center` | ~250 kB | map (dynamic) |
| median route | ~255–265 kB | within Next.js App Router norms |

**Assessment:** No route ships an outlier bundle. Maps and charts are `dynamic({ ssr: false })`, keeping them out of initial JS. Shared baseline 227 kB is reasonable for React 19 + TanStack Query + Zustand.

## Render stability
- Sidebar, top bar, KPI tiles, dashboards are `memo()`-wrapped.
- Render/mount probes (`useRenderProbe`/`useMountProbe`) instrument hot components.
- Heavy DOM is isolated behind `DashboardDOMBoundary`, `MapPerformanceBoundary`, `MapDOMIsolationBoundary`, `DeferAfterPaint`.
- **Verdict:** no render-storm patterns introduced by V4/V5 additions.

## Polling stability
- Query polling centralized in `lib/query-polling.ts` (e.g. `DASHBOARD_POLL_MS`, `COMMAND_KPI_POLL_MS 90s`, `OPS_MAP_POLL_MS 60s`).
- All new V5 dashboards use `staleTime: 120s` and **no** `refetchInterval` except live ops (`60–90s`) with `refetchIntervalInBackground: false`.
- **Verdict:** no polling storm; background tabs do not poll.

## WebSocket stability
- Single shared socket via `use-realtime-channel.ts` with pooling; `AdminRealtimeBridge` debounces cache invalidation.
- **Verdict:** no per-component socket fan-out.

## Query performance (backend, from infra scan)
- Prisma schema: **325 `@@index`**, **84 `@unique`** — strong index coverage.
- Redis read-through cache (`cache.service.ts`, L1 memory + L2 Redis) fronts heatmap/ops-map/digital-twin/customer-intel.
- Connection pooling via `database-url.ts` (`connection_limit` 8 dev / 15 prod, `pool_timeout 20s`); PgBouncer template in `deploy/k8s`.

## Memory
- Bounded caches on realtime (`BoundedEventCache`, capacity-limited).
- Virtualized tables (`@tanstack/react-virtual`) for large lists.
- **Verdict:** no unbounded in-memory growth observed in admin code.

## Gaps / recommended follow-ups
1. Add a seeded-staging **k6 run against admin read APIs** to capture p95 latency under load (infra exists: `scripts/load-test/k6/*`).
2. Add a bundle-size CI budget (e.g. fail if any route > 320 kB First Load JS).
3. Add React Profiler capture for Executive HQ under 100k-row datasets (virtualization already in place).

## Verdict
**PASS (static + build).** No regressions to prior performance certifications; all V5 additions follow existing perf boundaries. Load-based p95 evidence is the one open item, tracked in scale-readiness-report.md.
