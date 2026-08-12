# HOMIGO Mobile — Startup Hardening Report

**Date:** 2026-06-26  
**Scope:** Zero-regression hardening (post-certification)  
**Status:** Implemented

---

## Executive summary

Startup already passes adversarial certification. This program adds **regression protection**, **observability**, and **decoupling** improvements without changing proven bootstrap/splash logic.

---

## Phase 1 — Single points of failure

| Dependency | Blocks first render? | Hardening action |
|------------|---------------------|------------------|
| Auth bootstrap | No (background) | Unchanged — 25s deadline, `finally` guard |
| Splash | No | Unchanged — UI-decoupled, 1.5s + 3s failsafes |
| SecureStore | No | Unchanged — 5s cap inside bootstrap |
| AsyncStorage | No | Unchanged — 3s hydration timeout |
| Fonts | No | Added `FONTS_READY` marker; 5s timeout fallback |
| Router / providers | No | Unchanged |
| Realtime | No | Auth-gated — no WS until authenticated |
| Offline queue | No | **Deferred** until `INTERACTIVE` via `scheduleOfflineSync()` |
| AppOverlays queries | No paint block | **Deferred** until `INTERACTIVE` via `useAfterInteractive()` |

### Remaining risks (honest)

| Risk | Severity | Notes |
|------|----------|-------|
| Home tab public API queries (`HeroSection`, `RecommendedSection`) | Low | Still fire on mount; compete with bootstrap on bad networks. Not changed — home content depends on them. |
| Triple NetInfo listeners | Low | `use-network-status`, `QueryProvider`, `queue.ts` — consolidation deferred |
| Deep-link to protected tab during bootstrap | Low | `AuthGuard` shows spinner on bookings/wallet/profile only |
| No native Sentry SDK | Medium | Breadcrumbs via `__HOMIGO_SENTRY__` hook only |

---

## Phase 2 — Performance budgets

Enforced in `src/lib/startup-trace.ts` (`STARTUP_BUDGETS_MS`) and CI script `startup-performance-budget-check.mjs`.

| Budget | Limit | Enforcement |
|--------|-------|-------------|
| Hydration | 500ms | `checkStartupBudgets()` + CI |
| SecureStore | 1000ms | async step + CI |
| Bootstrap | 5000ms | marker span + CI |
| Splash visible | 1500ms | marker + CI |
| Interactive | 2000ms | marker + CI |

Dev builds log `[HOMIGO STARTUP] budget violations` when exceeded on device.

---

## Phase 3 — Observability

See `startup-observability-spec.md`.

**Key fix:** `reportColdStart()` / PAGELOAD vital now fires at `INTERACTIVE` (splash hide), not root layout mount.

---

## Phase 4 — CI regression protection

New GitHub Actions job `mobile-startup` in `.github/workflows/ci.yml`:

```
npm run typecheck          # homigo-mobile
npm run startup:regression # lint-guards + budgets + certification
```

Fails build on deadlock patterns, budget violations, or certification regression.

---

## Phase 5 — Resource hardening

| Area | Finding | Action |
|------|---------|--------|
| `traceAsyncStep` timer | Leak if promise settles first | Fixed — `finally` clears timer |
| AuthProvider timers | Cleaned on unmount | Already correct |
| `_layout` splash failsafe | Cleaned on unmount | Already correct |
| Offline sync | Ran at mount | Deferred to interactive |
| Realtime `processedEvents` Set | Unbounded | Out of startup scope — session-long |

---

## Phase 6 — Device certification prep

- `exportStartupDiagnostics()` → `globalThis.__homigoStartupDiagnostics`
- Metro logs full flame timeline on `INTERACTIVE` in `__DEV__`
- Marker chain includes `HYDRATION_START/END`, `BOOTSTRAP_END`, `FONTS_READY`

---

## Phase 7 — Future-proofing

`startup-lint-guards.mjs` blocks:

- `status` in `partialize`
- `await bootstrap()` in providers
- Missing `bootstrapInFlight` / `finally` / `hideSplashOnce`
- Multiple `preventAutoHideAsync`
- `initOfflineSync()` at layout mount

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/startup-trace.ts` | Budgets, new markers, `onInteractive`, diagnostics |
| `src/lib/observability/startup-telemetry.ts` | RUM publish on interactive |
| `src/stores/auth-store.ts` | `HYDRATION_START/END`, `BOOTSTRAP_END` |
| `src/providers/AuthProvider.tsx` | Telemetry on interactive |
| `app/_layout.tsx` | `markAppStart()`, defer offline sync |
| `src/lib/offline/sender.ts` | `scheduleOfflineSync()` |
| `src/hooks/use-after-interactive.ts` | Gate non-critical I/O |
| `src/components/app/AppOverlays.tsx` | Deferred discovery queries |
| `apps/backend/src/routes/ux-signals.ts` | Startup histogram metrics |
| `.github/workflows/ci.yml` | `mobile-startup` job |
| `scripts/startup-*.mjs` | Lint, budget, regression CI |

---

## Verification

```bash
cd homigo-mobile
npm run typecheck
npm run startup:regression
```

**Result (2026-06-26):** typecheck PASS, regression CI PASS (16/16 certification).
