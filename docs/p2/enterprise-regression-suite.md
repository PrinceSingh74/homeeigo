# Enterprise Regression Suite — Phases 16/17/18

**Date:** 2026-06-14 · **Runner:** `bun test` · **Isolation:** `NODE_ENV=test` → `homigo_test` (never live).

## Committed test (real DB assertions, no mocks)
`apps/backend/src/__tests__/phase16-18-regression.test.ts`

| Suite | Test | Asserts |
|---|---|---|
| 16.3 Geofencing | containment + ENTER/EXIT + 5-min duplicate suppression | ENTER=1, stay=0, re-enter suppressed |
| 16.3 Geofencing | 25× concurrent entry → exactly 1 ENTER (advisory lock) | ENTER=1 |
| 18 Checkout | wallet-only pay idempotent + ledger-consistent | balance −final once, re-pay alreadyPaid, **0 introduced drift** |
| 18 Checkout | insufficient balance rejected | `INSUFFICIENT_WALLET_BALANCE` |
| 17 Tracking | sub-10m/5s throttle + presence set | u2.throttled=true, isProviderOnline=true |

## Execution result
```
NODE_ENV=test bun test src/__tests__/phase16-18-regression.test.ts
 5 pass · 0 fail · 17 expect() calls · 3.55s
```

**STATUS: PASS.** Real assertions, isolated DB, green. CI integration: add `NODE_ENV=test bun test` to the pipeline (existing finance/ledger/RBAC suites also run here).

## Honest coverage note
This file covers the **highest-risk paths** (geofence concurrency, checkout zero-drift/idempotency, tracking throttle). Broader matrices (split/multi-source/giftcard/hcoin checkout, heatmap aggregation asserts, WS room-auth, Playwright admin/customer E2E) were verified earlier via execution scripts but are **not all committed yet** — recommended next CI additions.
