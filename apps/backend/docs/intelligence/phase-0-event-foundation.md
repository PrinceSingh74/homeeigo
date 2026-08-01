# HOMIGO Intelligence Platform — Phase 0: Event & Reliability Foundation

## Architecture

Phase 0 adds a **transactional outbox** inside the existing Bun/Elysia monolith. Business mutations and event intent are persisted in the **same PostgreSQL transaction**. An outbox processor (leader-locked cron) claims rows with `FOR UPDATE SKIP LOCKED`, publishes to an **in-process typed event bus**, and marks rows `PUBLISHED`.

```
Business Tx + Outbox Insert (atomic)
        ↓
Outbox Processor (SKIP LOCKED, stale recovery)
        ↓
Event Bus (isolated consumers, idempotency)
        ↓
Metrics / Audit / Automation / ML / AI hooks
```

**Delivery semantics:** at-least-once publication + idempotent consumers (`EventConsumerReceipt` unique on `consumerName + eventId`).

**Stale recovery:** `PROCESSING` rows with `lockedAt` older than `EVENTS_OUTBOX_LOCK_TIMEOUT_MS` return to `PENDING`.

## Related guides

- [Event Catalog](./phase-0-event-catalog.md)
- [Producer Guide](./phase-0-producer-guide.md)
- [Consumer Guide](./phase-0-consumer-guide.md)
- [PII Guide](./phase-0-pii-guide.md)
- [Replay Guide](./phase-0-replay-guide.md)
- [Security Threat Model](./phase-0-security-threat-model.md)

## Disaster recovery

| Scenario | Behavior |
|----------|----------|
| Backend crash after commit | Outbox row survives; processor republishes |
| Redis outage | PostgreSQL outbox remains SoT; leader lock falls back single-node |
| Consumer failure | Retry → DLQ; unrelated consumers continue |
| Process restart | Stale PROCESSING claims recover |
| Deployment | `stopOutboxProcessor()` graceful shutdown flag |

## Operations runbook

### Outbox growing

1. Check `homigo_outbox_pending` and `homigo_outbox_oldest_pending_age_seconds`
2. Verify `EVENTS_OUTBOX_ENABLED=true`
3. Inspect `event_outbox.last_error`
4. Scale instances — claiming is safe across cluster

### Consumer failures

1. Check `homigo_consumer_failed_total`, `homigo_dlq_unresolved`
2. Query `event_dead_letters WHERE resolved_at IS NULL`
3. Fix root cause; replay per [Replay Guide](./phase-0-replay-guide.md)

### Rollback

Set `EVENTS_OUTBOX_ENABLED=false` and/or `EVENTS_CONSUMERS_ENABLED=false`.

### Rollout

1. Deploy with flags disabled
2. Apply migration `20260731120000_event_foundation`
3. Enable staging flags; exercise booking/payment/tracking flows
4. Enable production domain flags incrementally

## Retention

| Data | Default retention | Env var |
|------|-------------------|---------|
| Published outbox | 14 days | `EVENTS_OUTBOX_PUBLISHED_RETENTION_DAYS` |
| Consumer receipts | 30 days | `EVENTS_RECEIPT_RETENTION_DAYS` |
| Resolved DLQ | 90 days | `EVENTS_DLQ_RETENTION_DAYS` |
| Completed scheduled jobs | 60 days | `EVENTS_SCHEDULED_JOB_RETENTION_DAYS` |

Cleanup runs in leader-locked retention tick.

## Phase 1 readiness

`homigo.partner.arrived` + `ml-feature-sink.v1` provide ETA label boundary for BigQuery ETL without coupling domain services.
