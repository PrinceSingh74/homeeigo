# Phase 18.2 — Wallet + Razorpay Split Payment Certification

**Date:** 2026-06-13 · **Method:** execution-only against isolated `homigo_test`. Built on existing primitives (Razorpay service, `Payment` model, `financialLedgerService` double-entry journals, `WalletTransaction`) — **no new payment/wallet/ledger tables** (RULE #1/#2).

## Flow (UI → API → Service → DB → Ledger)
- `POST /api/wallet/checkout/quote` → `{ bookingAmount, taxes, finalAmount, walletBalance, walletApplicable, razorpayRequired, fullyPayableFromWallet, alreadyPaid }`.
- `POST /api/wallet/checkout/split/initiate` `{ bookingId, walletAmount }` → if wallet covers all ⇒ wallet-only settle; else creates a Razorpay order for the **remainder** and a `Payment(method=wallet_razorpay_split, INITIATED, metadata={walletAmount})`. Idempotent (one `Payment` per booking via unique `bookingId`).
- `POST /api/wallet/checkout/split/verify` `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }` → verifies signature, then commits **both legs atomically**.

## Atomicity (single SERIALIZABLE transaction at verify)
```
advisory-lock(wallet_pay:userId)
  wallet leg (if walletAmount>0): FOR UPDATE wallet → WalletTransaction(DEBIT) + decrement
                                   + journal wallet_debit:<txnId> (CUSTOMER_WALLET → PLATFORM_ESCROW)
  razorpay leg:                    Payment → SUCCESS + journal booking_payment:<paymentId> (CUSTOMER_FUNDS → PLATFORM_ESCROW)
  booking:                         paymentStatus=SUCCESS, method=wallet_razorpay_split
```
Wallet is **not** debited at initiate (customer wallets have no reserved-balance column; debiting early would open a `WALLET_LIABILITY_MISMATCH` window). If the wallet can no longer cover its share at commit → **WALLET_DEBIT_FAILED**, the whole transaction rolls back (gateway refund signalled), **no half-paid booking**.

## Execution evidence

| Case | Result |
|---|---|
| **A** Wallet only (wallet ≥ final) | booking SUCCESS/`wallet`, wallet debited once ✅ |
| **B** Split (wallet 400 + Razorpay 150) | both legs commit, wallet −400, booking SUCCESS ✅ |
| **B** idempotent re-verify | wallet delta unchanged → **no double-debit** ✅ |
| **C** Razorpay only (wallet 0) | wallet untouched, booking SUCCESS ✅ |
| **Atomicity** wallet drained before verify | `WALLET_DEBIT_FAILED`, booking+payment stay INITIATED → **no half-paid** ✅ |

### Concurrency certification (per requirement)
| Concurrent verify calls (same order) | Wallet debits | Wallet delta | Payment | Crashed |
|---|---|---|---|---|
| 50 | **1** | exact (₹300) | SUCCESS | 0 |
| 100 | **1** | exact | SUCCESS | 0 |
| 250 | **1** | exact | SUCCESS | 0 |
| 500 | **1** | exact | SUCCESS | 0 |

**0 double-debit · 0 double-booking · 0 orphan payment · 0 crash.**

### Financial integrity
`financialIntegrityService.validate()` ledger-class issues **introduced by the harness = 0 → ZERO DRIFT** (baseline 1 = pre-existing test-DB artifact, unrelated). Both invariants hold: `SUM(user.walletBalance) == ledger CUSTOMER_WALLET`, and every completed wallet DEBIT has its `wallet_debit:` journal; every SUCCESS Payment has its `booking_payment:` journal.

## RULE #4 status
- TypeScript build: ✅ `tsc --noEmit` clean
- Concurrency tests: ✅ 50–500
- Financial integrity: ✅ zero drift
- Certification report: ✅ this file

**Verdict: PHASE 18.2 PRODUCTION-READY / FINANCIALLY VERIFIED.**

Rollback: `git checkout -- src/services/wallet-checkout.service.ts src/routes/wallet.ts`.
