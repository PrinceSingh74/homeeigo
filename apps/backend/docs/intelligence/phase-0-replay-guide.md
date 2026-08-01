# Phase 0 — Replay Guide

## Principles

- Replay is **operator-controlled** — no public replay API in Phase 0
- Idempotency via `EventConsumerReceipt` prevents duplicate business effects
- Use `force: true` only after fixing root cause (deletes receipt first)

## Replay entire bus dispatch

```typescript
import { replayOutboxEvent } from "../events/core/replay";

await replayOutboxEvent({ eventId: "<uuid>" });
```

## Replay single consumer

```typescript
await replayOutboxEvent({
  eventId: "<uuid>",
  consumerName: "audit.v1",
  force: false,
});
```

## Replay from DLQ row

```typescript
import { replayDeadLetterById } from "../events/core/replay";

await replayDeadLetterById("<dlqRowId>", false);
```

## Safe procedure

1. Identify failing `event_dead_letters` row or stale outbox event
2. Fix downstream root cause (audit DB, code bug, etc.)
3. Replay with `force: false` first
4. If receipt blocks legitimate re-run, use `force: true` once
5. Verify consumer receipt + DLQ `resolved_at`
