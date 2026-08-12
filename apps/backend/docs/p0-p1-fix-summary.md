# P0 + P1 Backend Fix Summary

**Date:** 2026-06-09  
**Scope:** Wallet double-credit, booking overlap, payment order overwrite, admin RBAC bypass, unauthenticated WS stats

## Issues Fixed

### P0-1: Wallet double-credit race
**Root cause:** `reconcileTopUpFromWebhook` and `verifyTopUp` used check-then-act without row locks; concurrent paths could both credit balance.

**Fix:** Shared `settleTopUpInTransaction()` with:
- `SELECT ... FOR UPDATE` on `wallet_transactions` and `users`
- Atomic `walletBalance: { increment }` instead of read-modify-write
- Idempotent return when status is already `COMPLETED`

**Files:** `src/services/wallet.service.ts`

### P0-2: Booking slot overlap race
**Root cause:** `validateBooking()` ran outside the DB transaction; two users could pass validation and both insert.

**Fix:**
- `assertNoConflictsInTransaction()` re-checks conflicts inside `SERIALIZABLE` transaction with `FOR UPDATE`
- Partial unique index on `(provider_id, scheduled_date)` for active bookings (DB backup)

**Files:** `src/services/booking.service.ts`, `src/services/booking-validation.service.ts`, migration `20260609220000_p0_p1_concurrency_rbac`

### P0-3: Payment order overwrite
**Root cause:** `createOrder()` called Razorpay then `upsert` overwrote `razorpayOrderId` on retry.

**Fix:**
- Deterministic `idempotencyKey` (`booking_order:{bookingId}`) with unique DB constraint
- Return existing order when `INITIATED` or `SUCCESS` without calling Razorpay again
- Optimistic `updateMany` + duplicate-key recovery on races

**Files:** `src/services/payment.service.ts`, `prisma/schema.prisma`

### P1-1: Admin RBAC bypass on payment refund
**Root cause:** `POST /api/payments/:id/refund` used `requireRole("ADMIN")` only — any admin role could refund.

**Fix:**
- Route mapped to `PAYMENTS.APPROVE` in `admin-route-permissions.ts`
- `adminRbacPlugin` extended to guard non-`/api/admin` scoped routes
- Refund route uses `adminRbacPlugin` + `requireAdminContext()`

**Files:** `src/routes/payments.ts`, `src/middleware/admin-rbac.ts`, `src/lib/admin-route-permissions.ts`

### P1-2: Compliance admin RBAC gaps
**Root cause:** Compliance admin endpoints only called `requireAdminContext()` without permission checks.

**Fix:** Admin routes mapped to scoped permissions (`USERS.READ`, `DISPUTES.APPROVE/REJECT`, `AUDIT_LOGS.READ`); enforced by extended `adminRbacPlugin`.

**Files:** `src/lib/admin-route-permissions.ts`, `src/middleware/admin-rbac.ts`

### P1-3: Unauthenticated WS stats
**Root cause:** `GET /api/v1/ws/stats` exposed connection metrics without auth.

**Fix:** Requires admin auth + `ANALYTICS.READ` permission via `authPlugin` + `adminRbacPlugin`.

**Files:** `src/index.ts`

## Database Migration

`prisma/migrations/20260609220000_p0_p1_concurrency_rbac/migration.sql`:
- Index on `wallet_transactions.reference_id`
- Index on `hcoin_transactions.reference_id`
- `payments.idempotency_key` (unique, backfilled)
- Partial unique index `bookings_provider_scheduled_active_key`

**Deploy:** `bunx prisma migrate deploy` (after backup)

## Verification

```bash
cd apps/backend
bun test                    # all tests pass
bunx prisma migrate deploy  # apply migration in staging/prod
```

### Manual checks
1. Wallet top-up: webhook + client verify concurrently → balance increases once
2. Two concurrent bookings same provider/time → one succeeds, one gets `PROVIDER_UNAVAILABLE`
3. Payment create-order retry → same `razorpayOrderId` returned
4. Support admin → `POST /api/payments/:id/refund` returns 403
5. Unauthenticated `GET /api/v1/ws/stats` → 401/403

## Rollback

1. Revert application deploy
2. Migration rollback (indexes are safe to keep; only drop if required):
   - `DROP INDEX IF EXISTS bookings_provider_scheduled_active_key`
   - `DROP INDEX IF EXISTS payments_idempotency_key_key`
   - `ALTER TABLE payments DROP COLUMN idempotency_key` (only if no code depends on it)

## Known Limitations

- Booking overlap uses 30-minute buffer windows (not discrete slots); partial unique index guards exact `scheduled_date` collisions only
- `walletBalance` remains `Float` — consider `Decimal` migration in a future phase
- Payment idempotency is per-booking, not per client-supplied header
