# Evidence — Wallet Load Test + Integrity Report

**Generated:** 2026-06-08T17:46:00Z  
**Verdict:** ❌ **FAIL** (integrity) · 🟡 **PARTIAL** (load)

## Load Test (`runner.ts` — wallet scenario → `/api/v1/status`)

| Concurrency | p95 (ms) | Error rate |
|---|--:|--:|
| 100 | 130 | **100%** |
| 500 | 219 | **100%** |
| 1000 | 377 | **100%** |

Concurrent top-up / transfer / cashback / referral mutations **NOT EXECUTED** (runner does not hit `/api/wallet/*`; k6 missing).

## Post-Load Integrity Validation (`bun run p2:wallet-integrity`)

**Executed:** 2026-06-08T17:44:24Z against live `homigo_db`  
**Exit code:** 1  
**Score:** 88/100 · Status: **FAIL**

| Criterion | Result | Violations |
|---|:--:|--:|
| No double-spend | ✅ PASS | 0 |
| No negative balance | ✅ PASS | 0 |
| No ledger drift | ❌ **FAIL** | 2 |

### Drift findings (real DB state)

1. **WALLET_LIABILITY_MISMATCH** [WARNING]: Ops wallet ₹7289 vs ledger CUSTOMER_WALLET ₹0
2. **HCOIN_LIABILITY_MISMATCH** [WARNING]: Ops H-Coin liability ₹42 vs ledger ₹0

These are **pre-existing ledger backfill gaps**, not introduced by load (no wallet mutations ran). Remediation: run ledger backfill (`/finance/backfill` admin flow or `ledger_backfill` scripts).

## Required to PASS

1. Run k6 `wallet.js` with auth + `ALLOW_WRITES=1` on staging
2. Re-run `p2:wallet-integrity` → score 100, zero drift
3. Execute ledger backfill for historical wallet/HCoin entries
