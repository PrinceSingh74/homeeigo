# ADR-001: Transactional Outbox Pattern

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Platform / Backend Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

HOMIGO coordinates booking, partner, and payment state changes across PostgreSQL, Redis, and external gateways. Business operations must emit domain events without risking dual-write inconsistency: a committed database change with a lost or prematurely published event, or a published event without a durable business record.

Phase 0 certification required proof that events survive process restarts, multi-instance deployment, and burst load with zero lost events across all certified stages.

---

## Problem

Publishing events directly to a message broker or invoking consumers inline from application code creates split-brain risk:

1. Database transaction commits but event publish fails → downstream systems miss state changes.
2. Event publishes but database rolls back → phantom events and incorrect consumer effects.
3. Cloud Run horizontal scaling multiplies concurrent publishers without coordination.

A durable, atomic coupling between business writes and event emission is required.

---

## Decision

Adopt the **transactional outbox pattern** as the sole certified path for durable domain event delivery:

1. Domain services insert rows into `event_outbox` in the **same PostgreSQL transaction** as business mutations.
2. A dedicated outbox processor (leader-elected; see ADR-003) claims pending rows and dispatches to registered consumers.
3. Terminal outbox states are `PUBLISHED` or `FAILED`; consumer-level failures route to DLQ (ADR-005) while outbox remains `PUBLISHED`.
4. Direct `dispatchEvent()` without outbox persistence is **not certified for durable production delivery** (Step 16 architectural limitation).

**Physical schema (Phase 0):** `event_outbox`, `event_dead_letters`, `event_consumer_receipts`, `scheduled_jobs` — created by migration `20260731120000_event_foundation`.

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Change Data Capture (Debezium / logical replication)** | Additional operational complexity; no existing GCP pipeline; higher certification surface for Phase 0 |
| **Dual-write (DB + broker)** | Known split-brain failure mode; no atomic guarantee |
| **In-process only event bus** | Events lost on instance recycle; failed Step 13 multi-instance requirements |
| **Saga orchestrator without outbox** | Heavier framework adoption; outbox already implemented and testable |
| **Cloud Pub/Sub as primary write path** | Business state still in PostgreSQL; does not eliminate dual-write |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Atomic business + event persistence | Additional table, processor, and monitoring |
| Replay from durable store | Eventual delivery latency (processor interval 5000 ms) |
| Idempotent consumer model (ADR-006) | At-least-once transport semantics |
| Operator visibility via metrics | Outbox backlog becomes critical SLO surface |

---

## Consequences

**Positive:**
- Stage E Step 14: 600 events (100 + 500 burst) drained with 0 lost, 0 stranded.
- Stage G soak: 136 events published, 0 lost over 62.3 minutes.
- Booking, partner, and payment lifecycles emit outbox events verified in Stage D.

**Negative:**
- Outbox processor is a single-leader tick (ADR-003); throughput bounded by batch size (50) and interval.
- `homigo_outbox_pending` and `homigo_outbox_oldest_pending_age_seconds` require alert coverage (ADR-009).

**Operational:**
- Feature flags `EVENTS_OUTBOX_ENABLED` and `EVENTS_CONSUMERS_ENABLED` gate runtime behavior (certified ON in staging @ Step 9).

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 10 booking outbox events | `docs/evidence/stage-d-step-10/step-10-booking-events.json` |
| Step 14 burst drain certification | `docs/evidence/stage-e-step-14/step-14-outbox-drain-certification.md` |
| Step 16 direct dispatch limitation | `docs/evidence/stage-e-step-16/step-16-retry-dlq-replay-certification.md` |
| Stage G reconciliation | `docs/evidence/stage-g-soak/stage-g-final-reconciliation.json` |
| Phase 0 schema | `docs/evidence/stage-c-step-7/step-7-schema-certification.md` |
| Final report §12.4 | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Outbox payload trace context propagation | Post-Phase 0 | See `opentelemetry-gap-analysis.md` |
| Partitioned outbox for very high throughput | Phase 2+ | Not required at current scale |
| Outbox archival / retention policy | Operations | Not certified in Phase 0 |

---

## Related ADRs

ADR-002 (Event Driven Architecture) · ADR-003 (Leader Election) · ADR-004 (Retry) · ADR-005 (DLQ) · ADR-006 (Idempotency)
