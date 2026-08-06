# ADR-004: Retry Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Platform / Backend Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

Distributed event delivery encounters transient failures: network blips, database lock timeouts, downstream rate limits, and consumer handler exceptions. Unbounded retries cause backlog growth; insufficient retries cause premature DLQ placement and operator toil.

Step 16 certified the hybrid retry model with bounded attempts, exponential backoff, and clear failure ownership between outbox processor and consumer inline paths.

---

## Problem

Without a defined retry policy:

1. Transient failures permanently mark events failed.
2. Infinite retries stall outbox drain and mask systemic issues.
3. Ambiguous ownership between outbox-level and consumer-level retries causes duplicate processing attempts or missed DLQ routing.

---

## Decision

Implement a **hybrid retry model** with separate ownership:

### Outbox delivery retries

| Parameter | Value |
|-----------|-------|
| Max attempts | 5 (`EVENTS_OUTBOX_MAX_ATTEMPTS`) |
| Mechanism | `markFailed()` schedules `availableAt` on next processor tick |
| Terminal state | `FAILED` on outbox row (no DLQ row for pure delivery failure) |
| Backoff | Exponential via `computeRetryDelayMs()` |

### Consumer inline retries

| Parameter | Value |
|-----------|-------|
| Max attempts | `min(consumer.maxAttempts, 3)` |
| Mechanism | `sleep(computeRetryDelayMs)` within single `dispatchEvent()` invocation |
| Terminal state | DLQ via `recordDeadLetter()`; outbox remains `PUBLISHED` |
| Transient detection | `isTransientConsumerError()` |

### Backoff formula (certified @ RC `c31f154`)

```
delay = min(300000, 2000 × 2^(attempt−1)) + jitter(0..min(1000, exp×0.1))
```

Base: 2000 ms. Maximum: 300000 ms (5 minutes). Jitter reduces thundering herd.

### Failure ownership matrix

| Failure Class | Owner | Retry | Terminal |
|---------------|-------|-------|----------|
| Outbox delivery failure | `outbox-processor.ts` | Scheduled re-attempt | Outbox `FAILED` |
| Consumer handler failure | `event-bus.ts` | Inline retry then DLQ | DLQ row + outbox `PUBLISHED` |

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Fixed-interval retry** | No jitter; thundering herd under burst recovery |
| **Infinite exponential retry** | Masks systemic failures; violates SLO alerting |
| **Immediate DLQ on first failure** | Excessive operator load; Step 16 proves bounded retry succeeds |
| **Separate retry queue table** | Additional schema; outbox `availableAt` sufficient |
| **Circuit breaker per consumer** | Not implemented @ c31f154; future enhancement |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Transient recovery without operator intervention | Maximum 5+3 attempts before terminal states |
| Jitter reduces coordinated retries | Latency under failure can reach minutes |
| Clear ownership aids debugging | Two retry paths to understand |
| Certified backoff curve | Tuning requires re-certification |

---

## Consequences

**Positive:**
- Step 16: controlled consumer failure → inline retries → DLQ → operator replay PASS.
- Step 13: 20 events succeeded on first attempt (ATTEMPTS_2 = 0, ATTEMPTS_GT_2 = 0) under normal load.
- Step 14: burst drain without unexplained retries.

**Negative:**
- Operator identity (WHO) not recorded on replay — audit gap documented in Step 16.
- Direct `dispatchEvent()` path has inline retry but is not certified for durable delivery (ADR-001).

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 16 certification | `docs/evidence/stage-e-step-16/step-16-retry-dlq-replay-certification.md` |
| Retry timeline | `docs/evidence/stage-e-step-16/step-16-retry-timeline.json` |
| Backoff analysis | `docs/evidence/stage-e-step-16/step-16-backoff-analysis.json` |
| Step 13 attempts | `docs/evidence/stage-e-step-13/step-13-multi-instance-certification.md` |
| Final report §12.6 | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Per-consumer circuit breakers | Reliability phase | Reduce DLQ noise from known bad deploys |
| Operator principal on replay | Security | Close Step 16 AUDIT_GAP |
| Retry metrics per attempt bucket | Observability | Enhance Grafana panels |

---

## Related ADRs

ADR-001 (Transactional Outbox) · ADR-005 (Dead Letter Queue) · ADR-006 (Idempotency)
