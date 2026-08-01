# Phase 0 — Consumer Guide

## Register a consumer

In `src/events/consumers/index.ts` (or a dedicated file imported at bootstrap):

```typescript
registerConsumer({
  name: "my-consumer.v1",        // stable identity for idempotency
  eventTypes: ["homigo.booking.completed"], // or "*"
  handler: myHandler,
  maxAttempts: 3,
});
```

Bootstrap runs at server start via `bootstrapEventConsumers()` in `index.ts`.

## Idempotency

Before side effects, the bus checks `EventConsumerReceipt` for `(consumerName, eventId)`.

Design handlers to be safe under **at-least-once** delivery.

## Failure handling

1. Transient errors → bounded inline retry with backoff
2. Exhausted retries → `EventDeadLetter` row + `recordConsumerSkipped`
3. One consumer failure never blocks unrelated consumers

## Low-cardinality metrics only

Never put `userId`, `bookingId`, or `eventId` in Prometheus labels.

Use structured logs for high-cardinality identifiers.

## Extraction readiness

Keep handler logic transport-agnostic. The same handler can later move to an external worker without changing event contracts.
