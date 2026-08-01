# Phase 0 — Producer Guide

## When to emit

Emit a domain event **inside the same Prisma transaction** as the business mutation using `emitInTransaction(tx, event)`.

Never emit after `commit` — that breaks the transactional outbox guarantee.

## Steps

1. Build a typed event with a catalog builder (`buildBookingCreatedEvent`, etc.).
2. Confirm the caller is already inside `prisma.$transaction` or `financialTransactionManager.executeWithLedger`.
3. Call `emitInTransaction(tx, event)` before the transaction callback returns.
4. Guard with feature flags when appropriate:
   - `EVENTS_OUTBOX_ENABLED`
   - `EVENTS_BOOKING_ENABLED` / `EVENTS_PAYMENT_ENABLED` / etc.

## Trace context

HTTP requests automatically bind `traceId` and `correlationId` via `request-context.middleware.ts`.

For webhooks, set causation explicitly:

```typescript
setCausationId(razorpayEventId);
```

## Payment helper

Use shared helpers to avoid drift:

```typescript
await emitPaymentSuccessInTransaction(tx, payment, completedAt);
await emitPaymentFailedInTransaction(tx, payment, reason, failedAt);
```

## Rollback behavior

If the business transaction rolls back, the outbox row rolls back with it — no ghost events.
