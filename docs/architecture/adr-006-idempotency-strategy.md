# ADR-006: Idempotency Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Platform / Backend Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

At-least-once delivery (ADR-001, ADR-003) guarantees events may reach consumers more than once. Business side effects — ledger entries, notification sends, audit records — must not duplicate under retry, replay, or concurrent delivery.

Step 15 certification explicitly tested sequential duplicate delivery and concurrent race conditions. Step 13 verified 60/60 consumer receipts with zero duplicate effective processing.

---

## Problem

Duplicate delivery causes:

1. Double audit entries and inflated metrics.
2. Duplicate notifications to customers and partners.
3. Financial inconsistencies if payment consumers are not idempotent.
4. DLQ replay amplifies risk if replays are not safe.

Exactly-once transport across distributed systems is not achievable without heavy coordination; the platform must target **exactly-once business effects**.

---

## Decision

Adopt **AT-LEAST-ONCE DELIVERY + IDEMPOTENT CONSUMERS → EXACTLY-ONCE BUSINESS EFFECTS**:

### Database enforcement

- Table: `event_consumer_receipts`
- Constraint: `UNIQUE(consumer_name, event_id)`
- Insert on first successful consumer processing; subsequent attempts detect existing receipt and skip effect.

### Consumer contract

1. Handlers must be safe to invoke multiple times for the same `(eventId, consumerName)`.
2. Side effects guarded by receipt check or equivalent idempotency key.
3. Certified consumers for `homigo.booking.created`: `metrics.v1`, `audit.v1`, `ai-context-indexer.v1`.

### Test coverage (Step 15)

| Scenario | Result |
|----------|--------|
| Sequential duplicate delivery (2 attempts) | 1 effective processing per consumer |
| Concurrent race (2 parallel attempts) | 1 effective processing per consumer |
| DUPLICATE_EFFECTS | 0 |

### Payment idempotency (related)

- Payment verify: `alreadySettled` on duplicate (Step 12).
- Webhook: HMAC validation + dedup (Step 12).
- DB-enforced payment idempotency keys (Wave-1 schema).

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Exactly-once broker semantics (Kafka transactions)** | No external broker in Phase 0 architecture |
| **Idempotency keys in application memory only** | Lost on instance recycle |
| **Dedup window with TTL only** | Insufficient for DLQ replay after hours/days |
| **Single global processed-events set** | Loses per-consumer granularity |
| **Pessimistic lock per event across all consumers** | Serializes consumer execution unnecessarily |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| DB-enforced correctness | Receipt table growth over time |
| Safe DLQ replay (ADR-005) | Consumer authors must implement idempotent handlers |
| Concurrent delivery safe | Not exactly-once transport (observable duplicate invocations) |
| Payment dedup aligned | Schema migration required (Wave-1) |

---

## Consequences

**Positive:**
- Step 15: PASS — 0 duplicate effects under sequential and concurrent delivery.
- Step 13: 60/60 expected receipts, 0 duplicate effective processing.
- Stage G: DUPLICATE_EFFECTS = 0 over full soak reconciliation.

**Negative:**
- Consumers that perform non-idempotent external calls (email, SMS) require outbox-side idempotency or external dedup keys — staging cert uses synthetic fixtures.
- Receipt table requires retention/archival policy (not certified in Phase 0).

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 15 certification | `docs/evidence/stage-e-step-15/step-15-idempotency-certification.md` |
| Concurrent duplicate test | `docs/evidence/stage-e-step-15/step-15-concurrent-duplicate-test.json` |
| DB constraints | `docs/evidence/stage-e-step-15/step-15-db-constraints.json` |
| Step 13 consumer reconciliation | `docs/evidence/stage-e-step-13/step-13-consumer-reconciliation.json` |
| Step 12 webhook idempotency | `docs/evidence/stage-d-step-12/step-12-webhook-idempotency.json` |
| Wave-1 payment idempotency | `docs/evidence/stage-d/step-d-wave1-clean-replay-certification.md` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Receipt table archival | Operations | Prevent unbounded growth |
| Idempotency lint / CI check for new consumers | Platform | Enforce handler contract |
| External notification dedup keys | Notifications | Production hardening |

---

## Related ADRs

ADR-001 (Transactional Outbox) · ADR-004 (Retry) · ADR-005 (DLQ) · ADR-007 (Payment Atomicity)
