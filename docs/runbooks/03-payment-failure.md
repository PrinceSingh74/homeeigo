# Runbook 03 — Payment Failure
**Symptoms:** spike in `payment_failed`, Razorpay webhook 4xx, customer "payment stuck".
1. Razorpay reachable + keys valid? Check `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` set.
2. Webhook signature failures → verify `RAZORPAY_WEBHOOK_SECRET` matches dashboard; webhook returns 401 on bad sig (by design).
3. Reconcile pending: `bun run reconcile:payments`.
4. Wallet/ledger drift? `bun run p2:wallet-integrity` (expect 100). If drift → DO NOT manually edit; run `reconcile:ledger`, escalate finance.
5. Idempotency: a double-charge cannot occur (per-booking idempotencyKey + serializable). Verify no duplicate `payments`/`wallet_transactions` for the booking.
6. Refund path: `bookingService` cancellation → refund to wallet/gateway.
