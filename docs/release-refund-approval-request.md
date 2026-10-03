# Refund remediation — WAITING FOR OWNER APPROVAL

Status: **WAITING_FOR_OWNER_APPROVAL.** Nothing has been refunded, repaired or deleted. The state
below was read from `homigo_db` on 2026-09-20 (SELECT only) and is what an approver should check
against before authorising anything.

Execution rule once approved: the **canonical paths only** (`processAdminRefund` / the cancellation
refund path) so the payment, refund, ledger, wallet, booking state and audit log all move together.
No manual SQL, no direct row edits.

## C1 — wallet-paid cancellations refunded ₹0 (4 bookings)

Customer: `customer@homigo.demo` (demo account). Each booking is `CANCELLED_BY_USER`,
`paymentStatus=SUCCESS`, `refundStatus=none`, `refundAmount=0`, with exactly one COMPLETED wallet
DEBIT (`referenceType=booking_wallet_payment`) and **no `payments` row** (wallet-funded, so there was
never a gateway payment).

| Booking | Paid from | Amount charged | Refunded so far | Owed |
|---|---|---|---|---|
| HOMIGO-20260616-00002 | wallet | ₹550 | ₹0 | **₹550** |
| HOMIGO-20260616-00003 | wallet | ₹550 | ₹0 | **₹550** |
| HOMIGO-20260616-00004 | wallet | ₹550 | ₹0 | **₹550** |
| HOMIGO-20260901-00001 | wallet | ₹660 | ₹0 | **₹660** |
| | | | **Total** | **₹2,310** |

- **Why it happened:** the historic wallet-refund defect — a wallet-paid booking has no `payments`
  row, and the old cancel path computed the refund from `payments`, so it refunded ₹0. Fixed since:
  the refund ceiling is now derived from the booking's own wallet debits.
- **Recommended action (per booking):** admin refund of the amount above through `processAdminRefund`
  (wallet leg), reason "wallet-refund defect remediation", then run the ledger backfill so the
  missing `WALLET_DEBIT` journals exist.
- **Verification after execution:** `refundStatus`/`refundAmount` set on the booking, one wallet
  CREDIT per booking, one balanced journal each, wallet balance consistency check passes, audit row
  naming the approving admin.
- **Note for the approver:** this is a demo account and the money is test money. The decision is
  whether to remediate at all — the engineering path is ready either way.

## C2 — provider-cancelled gateway booking stuck REFUNDING (1 booking)

`HOMIGO-20260812-00002` — ₹1,154, `CANCELLED_BY_PROVIDER`, `refundStatus=none`, `refundAmount=0`.
Payment `cmsq27fkm0291tz40wtc5w7ls` (`pay_TOrB6HcOfGROGy`, Razorpay **test** mode) is in `REFUNDING`
with `refundedAmount=0`. It carries four ₹1 refund requests keyed `f2-t05b-*` — artefacts of a
certification script that was run against `homigo_db`: three FAILED, one INDETERMINATE.

- **Why it is stuck:** the INDETERMINATE request holds the payment in `REFUNDING`, so any new refund
  reports `busy`. The cancellation itself pre-dates the refund-intent fix, so no refund was recorded.
- **Recommended action, in order:**
  1. Operator resolves the INDETERMINATE ₹1 request against Razorpay (test mode) — confirm with the
     gateway whether that ₹1 refund exists, then settle the request to SUCCESS or FAILED accordingly.
     `recoverStaleGatewayRefunds` does exactly this and is gated by `REFUND_AUTO_RECOVERY_ENABLED`
     (off on dev); enabling it for one controlled run is the supported route.
  2. With the payment no longer `REFUNDING`, issue the cancellation refund of **₹1,154** (minus any
     ₹1 the gateway confirms was actually refunded) through the canonical path.
- **Owed:** ₹1,154 (adjust by ≤₹3 if gateway confirms any of the ₹1 test refunds landed).
- **Verification after execution:** payment leaves `REFUNDING`, `refundedAmount` matches, booking
  carries the refund, one balanced journal, audit row present.

## C3 — assignment job owner mismatch (2 bookings, no money)

`HOMIGO-20260611-00002` (job owner null) and `HOMIGO-20260702-00002` (job names a different partner).
Both COMPLETED, both paid correctly, no money impact. The write-ordering defect behind them is fixed.
**Recommendation:** leave the historical rows as they are; correcting them changes history without
changing any balance. No approval required unless reporting needs the job rows to match.

---

**Owner:** finance + operations. **Engineering status:** paths ready and covered by regression tests
(`wallet-funded-refund.integration.test.ts`, `split-refund.integration.test.ts` D2, admin refund RBAC
coverage). Nothing executes without written approval.
