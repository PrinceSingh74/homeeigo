# Money representation — Float → integer paise (plan + evidence)

## 1. Inventory
- `prisma/schema.prisma`: 232 `Float` fields in total. 35 of them are money by name (amount / balance /
  price / commission / netEarning / tax / discount / debit / credit / refunded / fee).
- Every core money column has a `BigInt …_paise` twin. Since migration `20260609280000_money_paise_full_dual_write`,
  13 BEFORE INSERT/UPDATE triggers recompute the twin as `ROUND(float * 100)`. Tables covered: bookings,
  payments, wallet_transactions, earnings, withdrawals, ledger_entries, wallet_transfers,
  membership_cashbacks, users, providers, refund_requests, financial_adjustments, chargebacks.
- The application WRITES the Float and computes in Float, rounding to 2 dp (`round2`,
  `rupeesToPaise`). The ledger balance check (`LEDGER_UNBALANCED`) and `wallet_balance_consistency`
  compare Floats with a 0.005 tolerance.

## 2. Precision analysis (read-only, 2026-09-20)
13 core columns were checked on both databases. The query was
`abs(v*100 − round(v*100)) > 1e-7` for sub-paise values, plus `paise <> round(v*100)` for twin drift.

| DB | rows checked (sum) | sub-paise values | twin mismatches |
|---|---|---|---|
| homigo_test | 50,912 | **0** | **0** |
| homigo_db | 8,652 | **0** | **0** |

Every journal balances exactly on both DBs:
- homigo_test: 5,106 journals, ₹40,32,777.00 debit = credit.
- homigo_db: 971 journals, ₹7,09,341.10 debit = credit.

**Conclusion.** No stored value has ever needed more than paise precision. The twins are a complete,
verified shadow of the Float columns. The remaining risk is future Float arithmetic
(e.g. 0.1 + 0.2) in paths that skip `round2`. It is bounded by the triggers, which cannot preserve a
sub-paise error.

## 3. Design (paise authoritative)
1. **Compatibility layer.** A `Money` helper (`lib/money.ts`: paise bigint in, rupees only at the API
   edge). New code computes in paise.
2. **Flip the triggers' direction per table**, in one hand-scoped migration per table group. When only
   paise is written, derive the Float (`float = paise / 100.0`). When both are written, refuse any
   disagreement (RAISE). Readers keep working unchanged.
3. **Move writers to paise** (services in money-path order: ledger → wallet → payments → refunds →
   earnings → reports). Each writer is covered by the existing money-matrix, split-refund,
   wallet-funded-refund and release-concurrency suites.
4. **Shadow comparison.** Run the §2 query in CI and in the hourly integrity job (fail on any
   mismatch).
5. **Remove Float reads** from reports/exports. Drop Float columns last, in a separate release, after
   one full reconciliation cycle.

## 4. Production execution — BLOCKED
Requires:
- a production database (none is deployed — see memory `production-runtime-and-contamination`);
- a verified backup and restore rehearsal (Phase 23);
- a maintenance window and a rollback script per step (re-flip trigger direction; Float columns are
  never dropped in the same release).

**Owner:** platform engineering + finance sign-off on the reconciliation before and after.
