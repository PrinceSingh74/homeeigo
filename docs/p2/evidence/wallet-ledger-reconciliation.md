# P2 — Wallet / Ledger Reconciliation Evidence (Phase 2)

**Date:** 2026-06-08 · **Env:** local · **Services used (real, not mocked):** `FinancialIntegrityService.validate()`, `LedgerBackfillService.run()`, `FinancialLedgerService.recordJournal()`. **Runner:** `bun run p2:integrity`.

## Root cause
Σ `user.walletBalance` = **₹7289** across 3 users, but only **1** `WalletTransaction` existed and ledger `CUSTOMER_WALLET` = **₹10**. The wallet balances were seeded directly (pre-ledger) with no transaction to backfill from → a ₹7279 opening-balance gap flagged as `WALLET_LIABILITY_MISMATCH` (HIGH).

## Actions
1. **Backfill** — `LedgerBackfillService.run()` generated **11 missing journals** (GIFT_CARD ×2, HCOIN ×9). Re-runs are idempotent (11 scanned / 0 backfilled / 11 skipped).
2. **Opening-balance reconciliation** — posted ONE balanced journal for the ₹7279 delta, mirroring how a real top-up is recorded (`recordWalletTopUp` = Dr BANK_SETTLEMENT / Cr CUSTOMER_WALLET):
   - `type=ADJUSTMENT`, `idempotencyKey=opening_balance:customer_wallet:seed-reconciliation`
   - Dr `BANK_SETTLEMENT` ₹7279 / Cr `CUSTOMER_WALLET` ₹7279
   - Idempotent — cannot double-post.

## Evidence (validate() before → after)
| | Score | Status | info | warning | critical | issues |
|---|---|---|---|---|---|---|
| Before | 92 | FAIL | 0 | 1 | 0 | `WALLET_LIABILITY_MISMATCH` (Ops ₹7289 vs ledger ₹10) |
| **After** | **100** | **PASS** | 0 | **0** | **0** | **none** |

Post-reconciliation: Σ `user.walletBalance` ₹7289 == ledger `CUSTOMER_WALLET` ₹7289 (Δ ≤ ₹1).

## Result
**Phase 2: PASS — Integrity Score 100 (target ≥ 98), 0 critical.** Re-runnable via `bun run p2:integrity` (idempotent).

> Note: this was DEV seed data. In production, wallet balances are only created through journaled transactions, so this opening-balance gap does not arise; the reconciliation tool exists for exactly this pre-ledger/seed migration case.
