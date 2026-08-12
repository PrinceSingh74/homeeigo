# Payment order lifecycle

## States

| Status | Meaning |
|--------|---------|
| `INITIATED` | Gateway order created (or reserved); awaiting customer payment |
| `SUCCESS` | Payment captured and verified |
| `FAILED` | Gateway attempt failed or abandoned |

## createOrder idempotency

1. A payment row is **reserved in PostgreSQL first** with a unique `pending:{bookingId}:{uuid}` placeholder.
2. Only the reservation owner calls Razorpay.
3. Concurrent callers poll until the placeholder is replaced with the real `razorpay_order_id`.
4. Result: one payment row and one gateway order per booking intent.

## FAILED retry

When `createOrder` is called on a `FAILED` payment:

1. The current `razorpay_order_id` is appended to `metadata.previousRazorpayOrderIds`.
2. A **new** Razorpay order is created for the retry attempt.
3. The payment row is updated to `INITIATED` with the new order id.
4. Historical gateway references remain in `metadata` for reconciliation.

This is an explicit, auditable retry — not a silent overwrite.
