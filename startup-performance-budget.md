# HOMIGO Mobile — Startup Performance Budget

Hard budgets for cold start. Exceeding a budget does **not** block the user — it logs a warning in dev and emits `startup_budget_exceeded` to RUM.

---

## Budget table

| Phase | Budget | Source constant | Measured from |
|-------|--------|-----------------|---------------|
| AsyncStorage hydration | **500ms** | `STARTUP_BUDGETS_MS.hydration` | `HYDRATION_START` → `HYDRATION_END` |
| SecureStore read | **1000ms** | `STARTUP_BUDGETS_MS.secureStore` | async step `securestore` duration |
| Auth bootstrap | **5000ms** | `STARTUP_BUDGETS_MS.bootstrap` | `BOOTSTRAP_START` → `BOOTSTRAP_END` |
| Splash visible | **1500ms** | `STARTUP_BUDGETS_MS.splashVisible` | `APP_START` → `SPLASH_HIDE` |
| Interactive | **2000ms** | `STARTUP_BUDGETS_MS.interactive` | `APP_START` → `INTERACTIVE` |

---

## Hard caps (separate from budgets)

These are **safety ceilings** — bootstrap cannot hang past them regardless of budget:

| Cap | Value | Location |
|-----|-------|----------|
| Hydration wait | 3000ms | `AuthProvider` `HYDRATION_TIMEOUT_MS` |
| SecureStore | 5000ms | `auth-store` `SECURE_STORE_TIMEOUT_MS` |
| Bootstrap deadline | 25000ms | `auth-store` `BOOTSTRAP_DEADLINE_MS` |
| Splash UI fallback | 1500ms | `AuthProvider` `SPLASH_UI_READY_MS` |
| Splash root failsafe | 3000ms | `_layout.tsx` |
| Font load fallback | 5000ms | `useServicesFonts` |

---

## Runtime enforcement

```typescript
import { checkStartupBudgets, STARTUP_BUDGETS_MS } from "@/lib/startup-trace";

const violations = checkStartupBudgets();
// Dev: console.warn on violation
// Prod: startup_budget_exceeded → /api/ux-signals → Prometheus
```

Called automatically on `INTERACTIVE` via `publishStartupObservability()`.

---

## CI enforcement

```bash
npm run startup:budget
# or
node homigo-mobile/scripts/startup-performance-budget-check.mjs
```

Simulates happy-path startup. **Exit 1** if any budget exceeded.

Included in `npm run startup:regression` (CI gate).

---

## Grafana queries (after backend deploy)

```promql
# p95 mobile interactive time
histogram_quantile(0.95,
  sum by (le) (rate(mobile_startup_duration_seconds_bucket{signal="startup_interactive"}[5m]))
)

# Budget violations per hour
sum(rate(mobile_startup_signal_total{signal="startup_budget_exceeded"}[1h]))
```

---

## CI baseline (2026-06-26)

Happy-path simulator:

```json
{
  "hydration": 26,
  "bootstrap": 31,
  "splashVisible": 58,
  "interactive": 58,
  "secureStore": 20
}
```

All within budget.
