# ADR-003: Leader Election + FOR UPDATE SKIP LOCKED

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Platform / SRE |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

HOMIGO backend runs on Cloud Run with `minScale=2`, `maxScale=4` in staging. Multiple container instances execute concurrently against shared PostgreSQL and Redis. The outbox processor must claim and publish events without duplicate delivery, lost rows, or uncontrolled lock contention.

Step 13 certification explicitly required proof of safe concurrent processing across the deployed topology.

---

## Problem

Naive approaches fail under multi-instance Cloud Run:

1. **Every instance processes all pending rows** → duplicate consumer invocations (mitigated by idempotency but wastes resources and increases DLQ noise).
2. **Advisory locks without SKIP LOCKED** → instances block each other; latency spikes under load.
3. **No leader coordination** → thundering herd on outbox poll.
4. **Stale PROCESSING rows** after instance death → stranded events without recovery.

---

## Decision

Adopt **LEADER_SINGLE_ACTIVE_WITH_SKIP_LOCKED** as the certified processing model:

### Layer 1 — Redis leader election

- `runOutboxProcessorTick()` wraps `processOutboxBatch()` in `runWithLeaderLock("maintenance:event_outbox", ...)`.
- Only the leader instance executes the processor tick per interval (5000 ms default).
- Non-leader instances skip the tick without error.

### Layer 2 — PostgreSQL row claiming

- `claimBatch()` executes `UPDATE … FOR UPDATE SKIP LOCKED` on `event_outbox` rows in `PENDING` status.
- Batch size: 50 rows per tick.
- Lease timeout: 120000 ms (`lockTimeoutMs`); stale `PROCESSING` rows recovered automatically.

### Certified topology (Step 13)

| Field | Observed Value |
|-------|----------------|
| MIN_INSTANCES | 2 |
| OBSERVED_ACTIVE_INSTANCES | 2 |
| LEADER_WORKER | Single instance per tick |
| CLAIMS (20 events) | 20/0 leader/non-leader — expected under leader semantics |
| UNCONTROLLED_DUPLICATE_CLAIMS | 0 |

Uneven claim distribution (20/0) is **intentional**, not a defect.

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Dedicated worker service (single instance)** | Additional deployment unit; Cloud Run min=2 already required for availability |
| **PostgreSQL advisory lock only (no SKIP LOCKED)** | Blocking contention under concurrent polls |
| **External queue (SQS/Pub/Sub) as claim layer** | Duplicates outbox; adds infra without certification benefit |
| **Optimistic locking with version column only** | Higher retry churn; SKIP LOCKED is native PostgreSQL pattern |
| **All instances process in parallel without leader** | Certified safe only with idempotency; wastes compute; Step 13 proves leader model |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Zero uncontrolled duplicate claims | Single active processor per tick (throughput ceiling) |
| SKIP LOCKED avoids blocking | Requires PostgreSQL 16 (available on Cloud SQL) |
| Redis leader integrates with existing cache | Redis dependency for processor coordination |
| Stale row recovery | 120s worst-case delay for orphaned PROCESSING rows |

---

## Consequences

**Positive:**
- Step 13: 20/20 events terminal success; 60/60 consumer receipts; 0 lost, 0 stranded.
- Step 14: 500-event burst drained in seconds under same model.
- Stage G: multi-instance stable over 62.3-minute soak.

**Negative:**
- Throughput scales vertically (batch size, interval tuning) before horizontal outbox parallelism.
- Redis unavailability could delay processor ticks (health checks monitor Redis).

**Operational:**
- Monitor `homigo_outbox_pending` and leader lock contention via Step 14 DB pressure evidence.

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 13 certification report | `docs/evidence/stage-e-step-13/step-13-multi-instance-certification.md` |
| Runtime topology | `docs/evidence/stage-e-step-13/step-13-runtime-topology.json` |
| Event claim matrix | `docs/evidence/stage-e-step-13/step-13-event-claim-matrix.json` |
| Step 14 processing model | `docs/evidence/stage-e-step-14/step-14-outbox-drain-certification.md` |
| Redis leader review | `docs/evidence/stage-e-step-14/step-14-redis-leader-review.json` |
| Final report §12.9 | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Multiple outbox shards with per-shard leaders | Scale phase | Not required at current volume |
| Leader lock observability metric | SRE | Expose lock holder identity in /metrics |
| Failover drill for Redis outage | Operations | Document processor degradation mode |

---

## Related ADRs

ADR-001 (Transactional Outbox) · ADR-004 (Retry Strategy)
