# Developer Onboarding — HOMIGO Backend Phase 0

**Document ID:** `KT-DEV-ONBOARD-001`  
**Certified RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Audience:** Backend engineers joining HOMIGO  
**Navigation:** [Documentation Index](../DOCUMENTATION-INDEX.md) · [System Blueprint](../architecture/HOMIGO-ENTERPRISE-SYSTEM-BLUEPRINT.md) · [ADR Index](../architecture/ADR-INDEX.md)

---

## 1. Welcome

You are onboarding to a platform that has completed **Phase 0 staging certification**. The certified release is RC `c31f154` on Cloud Run revision `homigo-backend-staging-00029-pbn`.

**Read first:**
1. [ADR Index](../architecture/ADR-INDEX.md)
2. [Enterprise System Blueprint](../architecture/HOMIGO-ENTERPRISE-SYSTEM-BLUEPRINT.md)
3. [Final Certification Report](../final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md) — Sections 4 and 12

**Production is NOT DEPLOYED.** Your local and staging work should respect certified patterns; production promotion follows [Production Promotion Runbook](../operations/PRODUCTION-PROMOTION-RUNBOOK.md).

---

## 2. Project Structure

```
homigo/
├── apps/backend/                 ← Certified API (Bun, Hono/Express-style)
│   ├── src/
│   │   ├── events/core/          ← Outbox, event-bus, retry, DLQ, replay
│   │   ├── services/               ← Booking, partner, payment domain logic
│   │   └── lib/tracing.ts        ← W3C traceparent (no OTel export yet)
│   ├── monitoring/               ← Prometheus rules, Grafana JSON, Alertmanager
│   └── scripts/                  ← Certification harnesses
├── deploy/scripts/               ← staging-gcp-deploy.ps1, stage-d deploy
├── docs/
│   ├── architecture/             ← ADRs, blueprint, traceability
│   ├── evidence/                 ← 237 runtime certification artifacts
│   ├── final-certification/      ← Phase 0 dossier
│   └── operations/               ← Runbooks, operations handbook
└── prisma/                       ← Schema + migrations (31/31 on staging)
```

**Certified backend path:** `apps/backend/` @ RC `c31f154`.

---

## 3. Architecture Overview

HOMIGO backend uses **transactional outbox + internal event consumers**:

```
HTTP API → Domain Service → PostgreSQL (business + outbox row, same TX)
                                    ↓
                          Outbox Processor (leader-elected)
                                    ↓
                          Consumers (metrics, audit, AI indexer, …)
```

Full diagram: [Enterprise System Blueprint](../architecture/HOMIGO-ENTERPRISE-SYSTEM-BLUEPRINT.md)

**Processing model (certified):** `LEADER_SINGLE_ACTIVE_WITH_SKIP_LOCKED` — see ADR-003.

---

## 4. How Events Work

- Domain events use `homigo.*` naming: `homigo.booking.created`, `homigo.payment.success`, etc.
- Events are **not** published directly to an external broker for durable delivery.
- Envelope: `eventId`, `eventType`, `aggregateId`, `correlationId`, `occurredAt`, payload.
- Feature flags gate domains: `EVENTS_BOOKING_ENABLED`, `EVENTS_PAYMENT_ENABLED`, etc.

**ADR:** [ADR-002 Event Driven Architecture](../architecture/adr-002-event-driven-architecture.md)  
**Evidence:** `docs/evidence/stage-d/stage-d-certification.md`

---

## 5. How Outbox Works

1. Business code writes to `event_outbox` in the **same transaction** as domain tables.
2. `runOutboxProcessorTick()` runs under Redis leader lock `maintenance:event_outbox`.
3. `claimBatch()` uses `UPDATE … FOR UPDATE SKIP LOCKED` (batch size 50).
4. Successful publish → status `PUBLISHED`. Delivery failures → retry via `availableAt`.

**Never bypass outbox for durable domain events.** Direct `dispatchEvent()` is not certified for production durable delivery (Step 16).

**ADR:** [ADR-001](../architecture/adr-001-transactional-outbox-pattern.md)  
**Evidence:** Step 14 — `docs/evidence/stage-e-step-14/step-14-outbox-drain-certification.md`

---

## 6. How Payments Work

- Razorpay integration: order create → verify → webhook settlement.
- **Staging certified with TEST keys only** (`rzp_test_*`).
- Webhook HMAC validation + idempotency (`alreadySettled` on duplicate verify).
- Success emits `homigo.payment.success` via outbox.
- Financial atomicity via ledger service — amounts in paise.

**ADR:** [ADR-007](../architecture/adr-007-payment-financial-atomicity.md)  
**Evidence:** `docs/evidence/stage-d-step-12/step-12-payment-certification.md`

**Production LIVE payments:** NOT certified in Phase 0.

---

## 7. How Retry Works

**Hybrid model (ADR-004):**

| Layer | Max Attempts | Mechanism |
|-------|--------------|-----------|
| Outbox delivery | 5 | `markFailed()` + scheduled `availableAt` |
| Consumer inline | min(consumer.maxAttempts, 3) | sleep + `computeRetryDelayMs` |

Backoff: `min(300000, 2000 × 2^(attempt−1)) + jitter`

**Evidence:** `docs/evidence/stage-e-step-16/step-16-retry-dlq-replay-certification.md`

---

## 8. How DLQ Works

- Terminal consumer failures → `event_dead_letters` (key: `eventId` + `consumerName`).
- Outbox stays `PUBLISHED`; DLQ holds failure context.
- Operator replay: `replayDeadLetterById` → `replayOutboxEvent`.
- **Known gap:** operator WHO not recorded on replay (Step 16 AUDIT_GAP).

**ADR:** [ADR-005](../architecture/adr-005-dead-letter-queue-strategy.md)

---

## 9. How Observability Works

**Staging (certified):**
- Cloud Run `/metrics` with OPS Bearer auth
- GCE VM `homigo-obs-staging`: Prometheus + Grafana v11.3.0 + Alertmanager
- Dashboard UID: `homigo-operations`
- 42 alert rules (promtool validated)

**Gaps:**
- OpenTelemetry export NOT implemented — see `opentelemetry-gap-analysis.md`
- Slack delivery NOT_CONFIGURED on staging

**ADR:** [ADR-008](../architecture/adr-008-observability-architecture.md)

---

## 10. How Deployment Works

1. Commit to clean worktree at target SHA.
2. Build image `backend:<short-sha>` → digest-pinned.
3. Deploy via `deploy/scripts/staging-gcp-deploy.ps1 -CommitSha <SHA>`.
4. Run migrations via Cloud Run Job before or with deploy.
5. Verify revision digest matches expected.

**ADR:** [ADR-010](../architecture/adr-010-deployment-strategy.md)  
**Evidence:** `docs/evidence/stage-c-step-5/exact-commit-deployment-certification.md`

---

## 11. How Rollback Works

1. Shift Cloud Run traffic to prior known-good revision.
2. Disable consumers first if event issues: `EVENTS_CONSUMERS_ENABLED=false`.
3. Allow outbox drain before full event halt.
4. Database: forward-fix preferred; PITR clone for catastrophic failure.

**Runbook:** [ROLLBACK-RUNBOOK.md](../operations/ROLLBACK-RUNBOOK.md)  
**Staging rollback SHA (events OFF):** `e459175c72b1ece6e6246e5d69f559f23cd0a23e`

---

## 12. How Production Promotion Works

Production promotion is **documented but NOT EXECUTED**. Requires:

1. Board/CAB approval — [Go/No-Go Board Pack](../governance/PRODUCTION-GO-NOGO-BOARD-PACK.md)
2. Production secrets, observability, Slack routing
3. Execution of [Production Promotion Runbook](../operations/PRODUCTION-PROMOTION-RUNBOOK.md)

**ADR:** [ADR-012](../architecture/adr-012-production-promotion-strategy.md)

---

## 13. Common Mistakes

| Mistake | Why It Fails | Correct Approach |
|---------|--------------|------------------|
| Calling `dispatchEvent()` for durable events | Not certified; events lost on crash | Write to outbox in same TX |
| Deploying from dirty worktree | Breaks digest traceability | Clean detached worktree |
| Using fixed fixture names in cert harness | Stage G Run 1 FAIL (P2002 duplicate) | Unique names per run |
| Enabling consumers before outbox verified | Blast radius on failure | Incremental enablement (Stage D pattern) |
| Treating staging cert as production cert | Production NOT DEPLOYED | Run prod checklist |
| Ignoring `ScheduledJobLagHigh` alert | Known Phase 6 debt — don't rollback for this alone | Document and defer |
| Using Razorpay LIVE on staging | Safety violation | TEST keys only on staging |

---

## 14. Best Practices

1. **Read the ADR** before changing event, payment, or deploy behavior.
2. **Preserve evidence** — certification culture expects JSON + markdown artifacts.
3. **Use correlationId** on events for log tracing (OTel export deferred).
4. **Make consumers idempotent** — rely on `event_consumer_receipts` unique constraint.
5. **Check outbox metrics** after any event-related change: `homigo_outbox_pending`, `homigo_dlq_unresolved`.
6. **Never commit secrets** — Secret Manager only; SECRET_SCAN is mandatory on evidence.
7. **Match certified RC** when investigating production issues — local HEAD may differ from deployed artifact.

---

## 15. Coding Standards

- Follow existing patterns in `apps/backend/src/events/core/` — do not introduce parallel event systems.
- Prisma schema conventions: both sides of relations, `@updatedAt`, indexes on queried fields.
- Comments only for non-obvious business logic.
- Minimal scope in PRs — Phase 0 established focused diffs as norm.
- New consumers: implement idempotent handlers; register with versioned name (`*.v1`).
- Payment changes: maintain paise precision; never log card data.

**Schema reference:** `docs/evidence/stage-c-step-7/phase0-schema-inventory.json`

---

## 16. Key Commands (Staging)

```powershell
# Health check
curl https://homigo-backend-staging-144968192234.asia-south1.run.app/health

# Metrics (requires OPS token from Secret Manager)
curl -H "Authorization: Bearer $TOKEN" .../metrics

# Deploy staging @ SHA
./deploy/scripts/staging-gcp-deploy.ps1 -CommitSha c31f154a128022fa7d9c4e44652506eedf3fa3e4
```

**Do not rerun certification harnesses unless explicitly authorized** — Phase 0 is closed.

---

## 17. Further Reading

| Topic | Document |
|-------|----------|
| All docs | [DOCUMENTATION-INDEX.md](../DOCUMENTATION-INDEX.md) |
| Operations SOPs | [ENTERPRISE-OPERATIONS-HANDBOOK.md](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) |
| Traceability | [MASTER-TRACEABILITY-MATRIX.md](../architecture/MASTER-TRACEABILITY-MATRIX.md) |
| Event foundation | `apps/backend/docs/intelligence/phase-0-event-foundation.md` |

---

**Onboarding complete when:** You have read ADR-001 through ADR-006, the System Blueprint, and understand that **production is NOT DEPLOYED**.
