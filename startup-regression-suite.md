# HOMIGO Mobile — Startup Regression Suite

Automated tests that **fail the build** if startup deadlocks or anti-patterns return.

---

## Quick start

```bash
cd homigo-mobile
npm run startup:regression   # full CI gate
npm run startup:lint         # static guards only
npm run startup:budget       # performance budgets only
npm run startup:certify      # adversarial certification (16 phases)
```

From repo root (CI):

```bash
node homigo-mobile/scripts/startup-regression-ci.mjs
```

---

## Suite composition

| Step | Script | Duration | What it catches |
|------|--------|----------|-----------------|
| 1 | `startup-lint-guards.mjs` | <1s | Static anti-patterns |
| 2 | `startup-performance-budget-check.mjs` | <1s | Budget regressions |
| 3 | `startup-certification.mjs` | ~20s | Deadlock, corruption, crash recovery |

---

## Scenario coverage (certification)

| Scenario | Method |
|----------|--------|
| Cold start (fresh install) | Simulated empty bootstrap ×10 |
| Warm start | Cached token path |
| Kill + reopen | Crash injection before/during refresh ×5 |
| Offline start | Refresh throws |
| Expired / invalid token | 5 edge cases |
| Corrupt storage | 6 AsyncStorage blob variants |
| Backend unavailable | Live fetch to dead port |
| Slow SecureStore | 100ms–10s delays with 5s cap |
| 100 consecutive launches | No stuck `initializing` |

---

## Static guards (`startup-lint-guards.mjs`)

| Guard | Violation |
|-------|-----------|
| `partialize` persists `status` | Deadlock on rehydrate |
| `await bootstrap()` in provider | Blocks render |
| Missing `bootstrapInFlight` | Parallel bootstrap |
| Missing `finally` on bootstrap | Stuck initializing |
| Missing `hideSplashOnce` | Duplicate splash hide |
| Missing hydration timeout | Infinite AsyncStorage wait |
| `preventAutoHideAsync` ≠ 1 | Splash lifecycle break |
| `initOfflineSync()` at layout mount | Bootstrap network contention |

---

## CI integration

**Workflow:** `.github/workflows/ci.yml`  
**Job:** `mobile-startup`

Runs on every PR and push to `main`:

1. `npm ci && npm run typecheck` (homigo-mobile)
2. `node homigo-mobile/scripts/startup-regression-ci.mjs`

---

## Device tests (manual, not in CI)

For Expo Go / dev build / production build:

1. Launch app — confirm `[HOMIGO STARTUP]` marker chain in Metro
2. Kill mid-bootstrap — relaunch — no eternal spinner
3. Inspect `globalThis.__homigoStartupDiagnostics`

Expected marker order:

```
APP_START → NAVIGATION_READY → HYDRATION_START → HYDRATION_END →
HYDRATION → BOOTSTRAP_START → SECURESTORE → TOKEN_CHECK → REFRESH →
AUTH_READY → BOOTSTRAP_END → HOME_RENDER → SPLASH_HIDE → INTERACTIVE
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All regression checks pass |
| 1 | One or more steps failed — do not merge |

---

## Last run

**2026-06-26:** REGRESSION CI PASS — lint PASS, budget PASS, certification 16/16 PASS.
