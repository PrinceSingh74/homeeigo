# Money Integrity Report — Phase 2

**Date:** 2026-06-10  
**Model:** BIGINT paise dual-write (Float legacy columns retained)

---

## Audit Results

### 21-column drift validation (live SQL)

```bash
bun run verify:money-drift
```

**Result: 0 mismatches across all 21 money column pairs.**

| Column pair | Mismatches |
|-------------|------------|
| users.wallet_balance | 0 |
| providers.wallet_balance | 0 |
| payments.amount | 0 |
| wallet_transactions.amount | 0 |
| ledger_entries.debit/credit | 0 |
| bookings.final_amount/total_amount | 0 |
| withdrawals.amount | 0 |
| chargebacks.amount | 0 |
| *(all 21 checked)* | **0** |

### DB triggers

Migration `20260609280000_money_paise_full_dual_write` maintains `money_to_paise()` sync triggers on INSERT/UPDATE for all money tables.

### Wallet integrity

```bash
bun run p2:wallet-integrity
```

| Check | Result |
|-------|--------|
| Double-spend | ✅ 0 |
| Negative balances | ✅ 0 |
| Ledger drift | ❌ 1 warning (₹300 wallet vs ledger mismatch) |

**Known issue:** `WALLET_LIABILITY_MISMATCH` — ops wallet ₹9389 vs ledger CUSTOMER_WALLET ₹9689. Requires ledger backfill/reconciliation (not float drift).

### Automated tests

```bash
bun test
# 480 pass, 0 fail
```

---

## Float Retirement Status

| Status | Detail |
|--------|--------|
| Dual-write | ✅ Active (36 `*_paise` columns) |
| Reads | Code uses paise helpers (`money-paise.ts`) in financial paths |
| Float columns | 128 remain in PG (includes geo coords) |
| Cutover | **Not complete** — Float columns not dropped |

---

## 1M Transaction Simulation

**Not executed in this session.** Existing script: `scripts/money-concurrent-sim.ts` — run before production cutover.

---

## Rollback

1. Code continues reading Float fallback via `paiseToRupees`
2. Drop CHECK constraints from `20260610120000_enterprise_db_hardening` if needed
3. Paise columns remain source of truth; Float can be recomputed from paise

---

## Phase 2 Verdict

**PASS** for drift detection (0 mismatches)  
**IN PROGRESS** for Float column retirement and 1M sim  
**FAIL** wallet-ledger reconciliation (1 warning)
