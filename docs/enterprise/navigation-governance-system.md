# HOMIGO — Navigation Governance System

**Date:** 2026-06-22 · **Scope:** `apps/web` customer app. The rules every route + nav interaction
must satisfy, and the engine that enforces them.

> Principle: **acknowledge the click instantly, render the shell, stream data.** Never block a route
> transition on an API, an animation, or a heavy widget.

---

## 1. The five-stage budget (per click)

| Stage | Budget | HOMIGO mechanism |
|-------|:------:|------------------|
| **Visual feedback** (something moved) | **< 50 ms** | `RouteProgress` bar starts synchronously in the click handler + optimistic nav active state (measured **28 ms**) |
| **Route start** (commit begins) | immediate | Next App-Router client navigation; `<Link prefetch>` |
| **Shell visible** | **< 100 ms** | static prerendered route + `loading.tsx` Suspense fallback |
| **Content visible** | **< 200 ms** *(prefetch-warm)* | React Query cached data + skeletons; cold RSC commit is the gap (see §3) |
| **Interactive** | **< 400 ms** | TBT = 0 (no long tasks); hydration split by `next/dynamic` |

## 2. Prefetch governance (every nav target must be warm)

- **`<Link prefetch>`** on all primary nav (`BottomNav`).
- **Idle prefetch** (`RoutePrefetch`) of `/services /bookings /wallet /profile /ai` via `requestIdleCallback`.
- **Viewport prefetch**: Next prefetches in-viewport links by default.
- Rule: a route reachable from the current screen's nav **must** be in the prefetch set, so its RSC is
  cached before the click → commit ≈ 20 ms (home-class), not a cold fetch.

## 3. The measured bottleneck: RSC-commit warmth (flamegraph evidence)

A `/services` soft-nav profiled via CDP was **77% idle** (1247 / 1621 ms) — the CPU is **waiting on the
RSC payload fetch**, not rendering (render is ~15 ms; JS busy ~660 ms spread across the window).

**Governance rule:** the route-commit network wait is the only remaining gap, and it is a **prefetch-
warmth** problem, not a render problem. Real users (idle on a screen before clicking) get the prefetched
RSC → fast commit. The instant-feedback layer covers the wait either way. **Do not "fix" this by making
components render faster — that is not where the time goes.**

## 4. Hard rules (a violation is a navigation defect)

1. **No heavy SDK loads on a route that doesn't show it.** Maps/canvas/video must be `dynamic` + **visibility-gated** (IntersectionObserver). *(Fixed: home `LiveTrackingMapView` was loading Google Maps below the fold + leaving it running on other routes — now gated.)*
2. **No always-on background recorders by default.** Session Replay buffers DOM mutations continuously (~90 ms CPU/nav) — now **opt-in** (`NEXT_PUBLIC_SENTRY_REPLAY`), error/perf tracking unaffected.
3. **No blocking `await` before the page shell renders.** Data flows through React Query (non-blocking) behind skeletons.
4. **No route may depend on an animation completing to show content** (see `motion-design-system.md`).
5. **Every nav target prefetched** (§2).

## 5. Enforcement checklist (PR gate for any new route)
- [ ] Route is statically prerenderable (`○`) or has a `loading.tsx`.
- [ ] Added to the prefetch set if reachable from primary nav.
- [ ] Heavy widgets `dynamic` + visibility-gated; no SDK loads unless visible.
- [ ] No new always-on timers / observers / recorders mounted globally.
- [ ] Data via React Query (cached, deduped) — no `useEffect`+`fetch` waterfalls.
- [ ] Click → visual feedback < 50 ms (covered globally by `RouteProgress`).

## 6. The engine (where this lives)
| Concern | File |
|---------|------|
| Instant click feedback | `components/navigation/RouteProgress.tsx` |
| Optimistic active state | `components/BottomNav.tsx` |
| Idle prefetch | `components/navigation/RoutePrefetch.tsx` / `LazyRoutePrefetch.tsx` |
| Route/data caches | Next router cache + `next.config staleTimes` + React Query (`AppProviders`) |
| RUM (route-change/page-load) | `components/NavigationTracker.tsx` → `/api/vitals` → Grafana |
| Profilers | `scripts/{flamegraph,nav-spa,feedback-probe,perf-probe}.cjs` |
