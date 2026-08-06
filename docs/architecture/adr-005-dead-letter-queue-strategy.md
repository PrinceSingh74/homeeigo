# ADR-005: Dead Letter Queue Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Platform / Backend Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

After bounded retries (ADR-004) exhaust, consumer handler failures must not silently drop events or block the outbox indefinitely. Operators require a durable, inspectable queue for terminal failures with a controlled replay path.

Stage D harness (gate D7) and Step 16 certification validated intentional failure → DLQ → operator replay. Stage G soak maintained DLQ unresolved count at 0 under normal operation.

---

## Problem

Without a DLQ:

1. Terminal consumer failures are invisible except in logs.
2. Outbox rows in ambiguous states block reconciliation.
3. Operators lack a single artifact to inspect failure reason, consumer, and event identity.
4. Replay without idempotency guarantees risks duplicate business effects.

---

## Decision

Implement DLQ via the `event_dead_letters` table with the following contract:

### Data model

| Field | Semantics |
|-------|-----------|
| Key | `(eventId, consumerName)` — one DLQ row per consumer failure |
| Link | References outbox event; outbox status remains `PUBLISHED` after DLQ |
| Resolution | Operator replay marks resolved after successful reprocessing |

### Lifecycle

```
Consumer handler fails after inline retries exhausted
  → recordDeadLetter() inserts event_dead_letters row
  → homigo_dlq_unresolved metric increments
  → EventDlqGrowing alert evaluates (ADR-009)
  → Operator invokes replayDeadLetterById(dlqId)
    → replayOutboxEvent() re-invokes handler
    → recordConsumerSuccess() on success
    → DLQ row resolved
```

### Operator replay API

- Entry point: `replayDeadLetterById` → `replayOutboxEvent` (certified Step 16).
- Idempotency: consumer receipts prevent duplicate effects on replay (ADR-006).
- **Known gap:** operator principal (WHO) not recorded on replay — WHAT/WHEN/EVENT_ID/DLQ_ID logged.

### Metrics and alerts

- `homigo_dlq_unresolved` — primary DLQ backlog indicator.
- `EventDlqGrowing` — Prometheus alert with 15m `for:` duration (Step 18).

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Failed outbox rows only (no DLQ table)** | Cannot distinguish delivery vs handler failure; poor operator UX |
| **External DLQ (SQS dead-letter)** | Split visibility; outbox already in PostgreSQL |
| **Auto-replay on timer** | Risk of infinite failure loops; operator intent required |
| **Delete failed events** | Data loss; violates audit requirements |
| **Single global DLQ queue** | Loses per-consumer failure context |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Durable failure artifact | Additional table and operator workflow |
| Per-consumer failure isolation | DLQ rows accumulate without resolution |
| Replay with idempotency safety | Manual operator action required |
| Alert integration | 15m alert delay before firing |

---

## Consequences

**Positive:**
- Step 16: DLQ_ID `cmsfovz7e0001s60aod0dulv9` created, replayed, resolved — PASS.
- Stage D D7: intentional failure → DLQ → `replayDeadLetterById` PASS.
- All certification stages: final `homigo_dlq_unresolved = 0` after cleanup.

**Negative:**
- Auto-replay not certified; operational runbook must define replay authorization.
- Step 18: DLQ alert firing state not fully awaited (15m `for:`) — PASS_WITH_LIMITATION.

**Operational:**
- Synthetic Step 18 DLQ data cleaned post-certification; pre-existing scheduled job lag unrelated to DLQ.

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 16 DLQ certification | `docs/evidence/stage-e-step-16/step-16-retry-dlq-replay-certification.md` |
| DLQ state transitions | `docs/evidence/stage-e-step-16/step-16-dlq-state.json` |
| Replay result | `docs/evidence/stage-e-step-16/step-16-replay-result.json` |
| Stage D gates (D7) | `docs/evidence/stage-d/stage-d-gates-20260804T105915Z.json` |
| Step 18 DLQ alert | `docs/evidence/stage-f-step-18/step-18-dlq-alert.json` |
| Stage G DLQ final | `docs/evidence/stage-g-soak/stage-g-dlq.json` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Operator auth + principal on replay | Security | Close AUDIT_GAP |
| Admin UI for DLQ inspection | Operations | HOMIGO Radar integration |
| DLQ auto-triage rules | SRE | Classify transient vs permanent |

---

## Related ADRs

ADR-004 (Retry Strategy) · ADR-006 (Idempotency) · ADR-009 (Alerting)
