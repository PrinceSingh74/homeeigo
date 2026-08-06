# ADR-002: Event Driven Architecture

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Platform / Backend Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

HOMIGO domain operations — booking lifecycle, partner dispatch and tracking, payment settlement — produce side effects consumed by metrics indexing, audit logging, AI context indexing, notification routing, and automation scheduling. Tight synchronous coupling would inflate request latency and complicate failure isolation.

Phase 0 certified end-to-end event flows on staging with outbox-backed delivery, consumer idempotency, and observability counters.

---

## Problem

Monolithic synchronous orchestration creates:

1. Long critical paths on user-facing API requests.
2. Cascading failures when non-critical consumers (metrics, audit) fail during booking completion.
3. Difficulty adding new consumers without modifying core services.
4. No uniform contract for cross-service correlation and replay.

---

## Decision

Implement an **internal event-driven architecture** with these properties:

1. **Domain events** follow the `homigo.*` naming convention (e.g., `homigo.booking.created`, `homigo.partner.arrived`, `homigo.payment.success`).
2. **Envelope fields:** `eventId`, `eventType`, `aggregateId`, `correlationId`, `occurredAt`, payload — persisted in outbox (ADR-001).
3. **Consumer registration** per event type with versioned consumer names (e.g., `metrics.v1`, `audit.v1`, `ai-context-indexer.v1`).
4. **Delivery model:** at-least-once transport with exactly-once business effects via consumer receipts (ADR-006).
5. **Staging safety:** `STAGING_EVENTS_CERTIFICATION=1` required for certification harness execution; event domain flags (`EVENTS_BOOKING_ENABLED`, `EVENTS_PAYMENT_ENABLED`, `EVENTS_TRACKING_ENABLED`) control scope.

**Certified event flows (Stage D):**

```
booking.created → assigned → partner.dispatched → en_route → arrived
  → booking.started → booking.completed → payment.success
```

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **External Kafka / Pub/Sub as primary bus** | Outbox + in-process consumers sufficient for Phase 0; reduces infra certification scope |
| **REST webhook fan-out per consumer** | No durable replay; harder idempotency guarantees |
| **Database triggers only** | Opaque logic; poor observability and versioning |
| **Full CQRS with separate read models** | Over-engineering for Phase 0; partial indexing via consumers sufficient |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Decoupled side effects | Eventual consistency window |
| Additive consumer registration | Consumer receipt table growth |
| Uniform correlation via `correlationId` | Operators must understand async boundaries |
| Prometheus counters per event type | Metric cardinality management |

---

## Consequences

**Positive:**
- Stage D harness: 18/18 gates PASS including full booking + partner + payment event matrix.
- Step 10: booking lifecycle events with consumer receipts verified.
- Step 11: five partner events with ordering PASS.

**Negative:**
- `homigo_scheduled_job_lag_seconds` reflects automation jobs created but not executed (Phase 6 runner deferred).
- Cross-boundary distributed tracing incomplete until OTel export (ADR-008 gap).

**Operational:**
- Event flags pre-enabled on revision `00029-pbn` (Step 9 — no redeploy required).

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 9 event flags certification | `docs/evidence/stage-d-step-9/step-9-event-flags-certification.md` |
| Stage D aggregate certification | `docs/evidence/stage-d/stage-d-certification.md` |
| Stage D gate results | `docs/evidence/stage-d/stage-d-gates-20260804T105915Z.json` |
| Step 11 partner events | `docs/evidence/stage-d-step-11/step-11-partner-events.json` |
| Event foundation doc | `apps/backend/docs/intelligence/phase-0-event-foundation.md` |
| Final report §12.1–12.2 | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Scheduled job execution engine | Phase 6 | Consumer creates jobs; runner deferred |
| External event bridge (webhooks to partners) | Phase 2+ | Not Phase 0 scope |
| Event schema registry / versioning policy | Platform | Formalize breaking change process |
| OpenTelemetry span linkage across outbox delay | Post-Phase 0 | ADR-008 gap analysis |

---

## Related ADRs

ADR-001 (Transactional Outbox) · ADR-006 (Idempotency) · ADR-008 (Observability)
