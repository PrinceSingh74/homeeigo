# HOMIGO Mobile — Startup Observability Spec

How startup telemetry flows from device → backend → Prometheus/Grafana/Sentry.

---

## Marker taxonomy

### Required (certification)

| Marker | Emitted from | Meaning |
|--------|--------------|---------|
| `APP_START` | `_layout.tsx` | Root layout mounted |
| `NAVIGATION_READY` | `_layout.tsx` | Router stack ready |
| `HYDRATION` | `AuthProvider.tsx` | Bootstrap scheduled |
| `BOOTSTRAP_START` | `auth-store.ts` | Auth bootstrap began |
| `SECURESTORE` | `auth-store.ts` | Token read/migrate complete |
| `TOKEN_CHECK` | `auth-store.ts` | Token presence evaluated |
| `REFRESH` | `auth-store.ts` | Session refresh result |
| `AUTH_READY` | `auth-store.ts` | Terminal auth state reached |
| `HOME_RENDER` | `(tabs)/index.tsx` | Home tab mounted |
| `SPLASH_HIDE` | `AuthProvider.tsx` / failsafes | Native splash hidden |

### Extended (hardening)

| Marker | Emitted from | Meaning |
|--------|--------------|---------|
| `HYDRATION_START` | `auth-store.ts` persist | AsyncStorage read began |
| `HYDRATION_END` | `auth-store.ts` persist | Rehydrate complete |
| `BOOTSTRAP_END` | `auth-store.ts` | Bootstrap finished (any outcome) |
| `INTERACTIVE` | `AuthProvider.tsx` | User-perceived ready |
| `FONTS_READY` | `useServicesFonts.ts` | Poppins loaded or timed out |

---

## Console format

```
[HOMIGO STARTUP] MARKER [detail] +{sinceStartMs}ms
[HOMIGO STARTUP] ASYNC_START {name} +{ms}ms
[HOMIGO STARTUP] ASYNC_RESOLVED {name} {duration}ms +{ms}ms
```

Dev flame timeline on interactive:

```
globalThis.__homigoStartupTimeline
globalThis.__homigoStartupAsyncSteps
globalThis.__homigoStartupDiagnostics
globalThis.__homigoStartupBudgetViolations
```

---

## RUM pipeline

```
Mobile app (INTERACTIVE)
  → publishStartupObservability()
    → POST /api/vitals        (PAGELOAD, route=cold-start)
    → POST /api/ux-signals    (startup_* histograms)
  → Backend metrics
    → Prometheus
    → Grafana dashboards
```

### UX signals (startup)

| Signal | Value | Prometheus metric |
|--------|-------|-------------------|
| `startup_hydration` | ms | `mobile_startup_duration_seconds{signal}` |
| `startup_bootstrap` | ms | same histogram |
| `startup_splash_hide` | ms | same |
| `startup_interactive` | ms | same |
| `startup_budget_exceeded` | ms | same + counter `mobile_startup_signal_total` |

### Vitals

| Vital | Route | When |
|-------|-------|------|
| `PAGELOAD` | `cold-start` | `INTERACTIVE` (user-perceived) |

---

## Sentry breadcrumbs

On `INTERACTIVE`, if `globalThis.__HOMIGO_SENTRY__` is set:

```json
{
  "category": "startup",
  "level": "info|warning",
  "message": "HOMIGO mobile cold start",
  "data": {
    "timeline": [{ "m": "APP_START", "ms": 0 }, ...],
    "violations": ["hydration:520/500"]
  }
}
```

Native `@sentry/react-native` not installed — hook is optional for future wiring.

---

## Budget violation telemetry

When `checkStartupBudgets()` finds violations:

1. `console.warn` in `__DEV__`
2. `startup_budget_exceeded` beacon per violation
3. Sentry breadcrumb level `warning`

---

## Grafana panel suggestions

| Panel | PromQL |
|-------|--------|
| p50 interactive | `histogram_quantile(0.5, rate(mobile_startup_duration_seconds_bucket{signal="startup_interactive"}[5m]))` |
| p95 bootstrap | `histogram_quantile(0.95, rate(mobile_startup_duration_seconds_bucket{signal="startup_bootstrap"}[5m]))` |
| Budget violations | `sum(rate(mobile_startup_signal_total{signal="startup_budget_exceeded"}[1h]))` |
| Cold start PAGELOAD | `histogram_quantile(0.95, rate(web_vitals_page_load_seconds_bucket{route="cold-start"}[5m]))` |

---

## Device certification

Call `exportStartupDiagnostics()` or inspect after launch:

```javascript
// Metro debugger / Flipper
JSON.stringify(globalThis.__homigoStartupDiagnostics, null, 2)
```

Supports: Android, iPhone, iPad, Expo Go, dev build, production build (same JS bundle markers).

---

## Implementation files

| File | Role |
|------|------|
| `src/lib/startup-trace.ts` | Markers, budgets, flame timeline |
| `src/lib/observability/startup-telemetry.ts` | RUM publish on interactive |
| `src/lib/observability/telemetry.ts` | Base vitals/ux beacon helpers |
| `apps/backend/src/routes/ux-signals.ts` | Startup histogram ingestion |
| `apps/backend/src/routes/vitals.ts` | PAGELOAD with `cold-start` route |
