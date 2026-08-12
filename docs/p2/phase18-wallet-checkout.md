# Phase 18 — Wallet Checkout (incremental, on existing architecture)

**Approach:** the spec's `Wallet` / `LedgerEntry` / `SplitPayment` / `Cashback` models duplicate HOMIGO's existing financial tables (`WalletTransaction`, `JournalEntry`, `LedgerEntry`, `GiftCard`, `HCoinWallet`, `cashback.service`). Creating them would cause **financial drift** — forbidden by the mission. So Phase 18 is built **on the existing double-entry ledger primitives** (`financialLedgerService`, `financialTransactionManager.executeWithLedger`), no new financial tables.

## Increment 1 — Wallet-funded booking payment ✅ DONE & CERTIFIED

**Files:** `src/services/wallet-checkout.service.ts`, routes in `src/routes/wallet.ts`.

**Endpoints (auth-gated, verified live → 401 without token):**
- `POST /api/wallet/checkout/quote` `{ bookingId }` → breakdown (finalAmount, walletBalance, walletApplicable, remainderDue, fullyPayableFromWallet, alreadyPaid).
- `POST /api/wallet/checkout/pay` `{ bookingId }` → pays the booking in full from wallet balance (requires verified email, like add-money).

**Accounting (zero-drift by design):** wallet money is already platform-held prepaid funds (`CUSTOMER_WALLET` liability). Paying a booking reclassifies it into booking escrow:
```
Debit  CUSTOMER_WALLET   (we owe the customer less)
Credit PLATFORM_ESCROW   (funds now held for the booking)
```
A `WalletTransaction(type=DEBIT, COMPLETED, referenceType="booking_wallet_payment")` is created and the journal is keyed `wallet_debit:<txnId>`, so both integrity invariants hold: `SUM(user.walletBalance) == ledger CUSTOMER_WALLET`, and every completed debit has its `WALLET_DEBIT` journal. No phantom `CUSTOMER_FUNDS` asset is created (the cash never moved — it was already ours).

**Safety:** manual `SERIALIZABLE` transaction + `pg_advisory_xact_lock('wallet_pay:'+userId)` + `SELECT … FOR UPDATE` on the wallet row + idempotency guard (prior completed wallet-payment for the booking) + `withTxRetry`.

**Execution evidence (isolated homigo_test):**
| Test | Result |
|---|---|
| Quote | finalAmount 550, walletApplicable 550, fullyPayable ✅ |
| Pay in full | balance 2000 → 1450 (−550), booking `paymentStatus=SUCCESS, method=wallet` ✅ |
| Idempotent re-pay | `alreadyPaid`, balance unchanged → **no double-debit** ✅ |
| Insufficient (100 < 550) | `INSUFFICIENT_WALLET_BALANCE` ✅ |
| **Concurrency 30×** | **exactly 1 debit**, balance −550 once ✅ |
| **Financial integrity** | introduced ledger issues = **0 → ZERO DRIFT** ✅ |

Backend live, routes registered, `tsc` clean.

## Remaining increments (planned)
- **18.2** Split: wallet covers part, Razorpay the remainder (reuse existing `paymentService.createOrder/verify` for the remainder; wallet portion via increment 1).
- **18.3** Gift card + HCoin as checkout sources (reuse `GiftCard` redemption + `hcoinService.redeem`).
- **18.4** Customer checkout UI (`apps/web`) wired to the endpoints (adapt the spec's React component to the real API shape + native auth).

## Known limitations (increment 1)
- Pays the booking **in full** from wallet (partial/split is 18.2).
- Refund for a wallet-paid booking (no `Payment` row) flows via `finalAmount` fallback in cancellation; a dedicated wallet-refund path is a follow-up.
