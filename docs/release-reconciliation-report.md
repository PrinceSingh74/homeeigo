# Read-only reconciliation report — dev `homigo_db`

Generated 2026-09-20 by `bookingConsistencyService.run()` (8 SELECT-only checks) plus per-row context
queries. **Nothing in `homigo_db` was modified.** Target asserted as `homigo_db` before every query.

| Check | Rows |
|---|---|
| PAID_WITHOUT_MONEY | 77 |
| CANCELLED_PAID_NOT_REFUNDED | 55 |
| OPEN_OFFER_ON_CLOSED_BOOKING | 13 |
| COMPLETED_WITHOUT_EARNING | 6 |
| JOB_OWNER_DISAGREES | 2 |
| **Total** | **153 (142 distinct bookings)** |

Classification: **A (historical fixture) 146 · C (genuine, pre-remediation) 7 · UNKNOWN 0.**

## A — Historical fixtures (146)

Booking numbers are not the production format `HOMIGO-YYYYMMDD-NNNNN`; every prefix traces to the script
or test that inserted the row directly (not through the product path):

| Prefix | Rows | Generator | Checks |
|---|---|---|---|
| `S03L-` | 72 | scripts/section03-free-partner-capacity.ts, section03-lifecycle-api-cert.ts | CANCELLED_PAID_NOT_REFUNDED 48, OPEN_OFFER 13, PAID_WITHOUT_MONEY 11 |
| `S07-`, `S07A-` | 30 | scripts/section07-live-cert.ts | PAID_WITHOUT_MONEY |
| `S10F-` | 12 | scripts/e2e-disposable-fraud-commission.ts | PAID_WITHOUT_MONEY |
| `S03-`, `S03C-` | 18 | scripts/section03-db-cert.ts, section03-seed-live-job.ts | PAID_WITHOUT_MONEY |
| `XSYS-` | 3 | scripts/cross-system-production-lock-cert.ts | PAID_WITHOUT_MONEY |
| `P03-` | 3 | src/__tests__/assignment-dispatch-lock.test.ts (ran against homigo_db before test-DB isolation) | PAID_WITHOUT_MONEY |
| `ADV-` | 6 | src/__tests__/helpers/adversarial-fixtures.ts (same) | COMPLETED_WITHOUT_EARNING |
| `DBG-` | 2 | scripts/section03-debug-accept.ts | CANCELLED_PAID_NOT_REFUNDED |

Could current code produce them? **No.**
- `payment_status = SUCCESS` is written only by `applyBookingPaymentSuccess` after a capture/debit.
- `complete()` posts the earning in the same transaction.
- `cancel()` records the refund intent in its own transaction.
- Open offers close inside the cancel/accept/reassign transaction.

All four are covered by regression tests (`booking-payment-integrity`, `admin-booking-integrity`,
`booking-consistency`). Action: none. They are not "fixed" by editing data.

## C — Genuine, pre-remediation (7)

### C1. Wallet-paid cancellations refunded ₹0 — 4 bookings
`HOMIGO-20260616-00002`, `-00003`, `-00004` (₹550 each), `HOMIGO-20260901-00001` (₹660). Account
`customer@homigo.demo`, status CANCELLED_BY_USER, refund_status `none`. There is one COMPLETED wallet
DEBIT per booking, no refund credit and no WALLET_DEBIT journal.

- **Root cause:** the historic wallet-refund defect: a wallet-paid booking has no `payments` row, and the
  old cancel refunded ₹0. The debits also predate the wallet-checkout ledger.
- **Fixed:** refunds are now computed from the booking's own wallet debits.
- **Regression tests:** `wallet-funded-refund.integration.test.ts`, `booking-payment-integrity` (wallet
  pay after cancel refused).
- **Remediation plan (owner-approved, not automatic):** admin partial refund of the paid amount through
  `processAdminRefund` (wallet leg), then run the ledger backfill for the missing WALLET_DEBIT journals.
  Customer is a demo account. The amounts are test money.

### C2. Provider-cancelled gateway booking stuck REFUNDING — 1 booking
`HOMIGO-20260812-00002` (₹1154, test-mode `pay_TOrB6HcOfGROGy`), CANCELLED_BY_PROVIDER 2026-08-17,
refund_status `none`, payment REFUNDING. The payment carries four ₹1 refund requests with keys
`f2-t05b-*` (a certification script run against homigo_db). Three are FAILED and one is INDETERMINATE.

- **Root cause (two parts):**
  1. The cancellation pre-dates the refund-intent fix and recorded no refund.
  2. The INDETERMINATE request holds the payment in REFUNDING, so any cancellation refund would now
     report `busy`.
- **Current code:** a provider cancel records a 100% refund intent in the cancel transaction.
  `recoverStaleGatewayRefunds` resolves REFUNDING/INDETERMINATE by asking the gateway, and
  `recoverStrandedCancellationRefunds` then finishes the intent. Both are gated by
  `REFUND_AUTO_RECOVERY_ENABLED` (off on dev).
- **Regression tests:** `split-refund.integration.test.ts` D2 suite (crash-safe gateway refund).
- **Remediation plan:** operator resolves the INDETERMINATE request against Razorpay (test mode), then
  issues the cancellation refund. Not automatic.

### C3. Assignment job owner differs from booking owner — 2 bookings
`HOMIGO-20260611-00002` (job owner null) and `HOMIGO-20260702-00002` (job says a different partner).
Both are COMPLETED, with no admin actions on either.

- **Root cause:** the old accept path updated the job post-commit, detached, and could lose or misorder
  that write.
- **Fixed:** `markAcceptedInTx` runs inside the accept transaction. The detached pass refuses when the
  booking has moved to another partner. Admin reassign sets the job owner in its transaction.
- **Regression test:** `admin-booking-integrity` "A accepts ⟂ admin reassigns ×4" asserts
  `job.currentProviderId === booking.providerId`.
- **Impact:** metadata only. The booking row is authoritative for earnings and ownership. No action.
