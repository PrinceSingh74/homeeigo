# HOMIGO PHASE 0 / STAGE E
# STEP 16 — RETRY, DLQ & OPERATOR REPLAY CERTIFICATION REPORT

**Date:** 2026-08-05  
**Auditor role:** Principal Reliability Engineer / Staff Backend / DBRE / SRE / Release Certification Engineer  
**Authoritative execution:** `homigo-step16-retry-dlq-replay-cert-jwmng`

---

## 1. Executive Result

| Field | Value |
|-------|-------|
| **STEP_16** | **PASS_WITH_ARCHITECTURAL_LIMITATION** |
| **CRITICAL_FAILURES** | 0 |
| **NON_CRITICAL_WARNINGS** | 2 |
| **STEP16_RUN_ID** | `stage16-cert-1785910303812` |
| **EVENT_ID** | `11087a8e-2a00-4e06-8e08-274e94203539` |
| **DLQ_ID** | `cmsfovz7e0001s60aod0dulv9` |

**Non-critical warnings:**
1. `/ready` returns HTTP 401 without OPS token (expected auth-gated behavior, consistent with Steps 10–15)
2. `AUDIT_GAP`: operator identity (WHO) not recorded on `replayDeadLetterById` — forensic traceability covers WHAT/WHEN/EVENT_ID/DLQ_ID but not operator principal

**Architectural limitation:** Direct `dispatchEvent()` path supports consumer inline retry + DLQ but is **NOT certified for durable production delivery** — durable events must enter via transactional outbox.

**Delivery model certified:** AT-LEAST-ONCE DELIVERY + BOUNDED INLINE RETRY + DLQ + OPERATOR REPLAY + IDEMPOTENT BUSINESS EFFECTS

---

## 2. Release Identity

| Field | Value |
|-------|-------|
| APPLICATION_RC_SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| IMAGE_DIGEST | `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32` |
| CLOUD_RUN_REVISION | `homigo-backend-staging-00029-pbn` |
| TRAFFIC_PERCENT | 100 |
| IMAGE_REBUILT | NO |
| REDEPLOYED | NO |

Local worktree HEAD (`22193fa`) differs from certified RC — certification authority is the deployed artifact, not local dirty worktree.

---

## 3. Environment

| Field | Value |
|-------|-------|
| PROJECT | `homigo-497619` |
| REGION | `asia-south1` |
| SERVICE | `homigo-backend-staging` |
| DATABASE | `homigo_staging_db` |
| DATABASE_INSTANCE | `homigo-staging-step6a-pitr-20260803` |
| APP_ENV | `staging` |
| MIN_INSTANCES | 2 |
| EVENTS_OUTBOX_ENABLED | `true` |
| EVENTS_CONSUMERS_ENABLED | `true` |
| BACKUP | ON |
| PITR | ON |
| DELETION_PROTECTION | ON |
| MIGRATIONS | 31/31 |

---

## 4. Retry Architecture

| Field | Value |
|-------|-------|
| PROCESSING_MODEL | **HYBRID** |
| MAX_ATTEMPTS (outbox) | 5 (`EVENTS_OUTBOX_MAX_ATTEMPTS`) |
| MAX_ATTEMPTS (consumer inline) | `min(consumer.maxAttempts, 3)` |
| BACKOFF | `min(300000, 2000 × 2^(attempt−1)) + jitter(0..min(1000, exp×0.1))` |
| DLQ_MODEL | `event_dead_letters` per `(eventId, consumerName)` |
| REPLAY_MODEL | `replayDeadLetterById` → `replayOutboxEvent` → handler + `recordConsumerSuccess` |

### Failure ownership (forensically mapped)

| Failure class | Owner | Retry mechanism | Terminal state |
|---------------|-------|-----------------|----------------|
| **OUTBOX DELIVERY FAILURE** | `outbox-processor.ts` `markFailed()` | Scheduled via `availableAt` on next processor tick | `FAILED` (no DLQ row) |
| **CONSUMER HANDLER FAILURE** | `event-bus.ts` `processConsumer()` | Inline `sleep(computeRetryDelayMs)` within single `dispatchEvent` | DLQ via `recordDeadLetter()`; outbox stays `PUBLISHED` |

**Source paths:**
- `apps/backend/src/events/core/outbox-processor.ts` — `claimBatch()`, `FOR UPDATE SKIP LOCKED`, `publishRow()`, `markFailed()`
- `apps/backend/src/events/core/event-bus.ts` — `dispatchEvent()`, `processConsumer()`, `invokeConsumer()`
- `apps/backend/src/events/core/retry.ts` — `computeRetryDelayMs()`, `isTransientConsumerError()`
- `apps/backend/src/events/core/dead-letter.ts` — `recordDeadLetter()`
- `apps/backend/src/events/core/replay.ts` — `replayDeadLetterById()`, `replayOutboxEvent()`

---

## 5. Controlled Failure

| Field | Value |
|-------|-------|
| EVENT_CREATED | YES |
| EVENT_PERSISTED | YES (outbox PENDING → PUBLISHED) |
| CONSUMER_FAILURE | `step16.fail.v1` throws `STEP16_CONTROLLED_FAIL` |
| FAILURE_EXPECTED | YES (deterministic, scoped to Step-16 marker) |
| BUSINESS_EFFECT_BEFORE_FAILURE | 0 |

Failure injection: Cloud Run Job registers `step16.fail.v1` consumer locally, emits synthetic `homigo.booking.created` via `emitStandalone`, processes via `processOutboxBatch()` (cert job claims via SKIP LOCKED). No certified RC modification required.

---

## 6. Retry Timeline

| Attempt | Timestamp (UTC) | Result | Observed backoff |
|---------|-------------------|--------|------------------|
| 1 | 2026-08-05T06:11:44.551Z | FAIL | — |
| 2 | 2026-08-05T06:11:46.713Z | FAIL | 2162 ms (expected 2000–2200) |
| 3 | 2026-08-05T06:11:50.904Z | FAIL | 4191 ms (expected 4000–4400) |
| MAX | 3 = configured | → DLQ | BACKOFF_GATE: **PASS** |

Outbox status after consumer failures: `PUBLISHED` (attempts=1) — consumer failures do not re-queue outbox.

---

## 7. DLQ

| Field | Value |
|-------|-------|
| DLQ_CREATED | YES |
| DLQ_ID | `cmsfovz7e0001s60aod0dulv9` |
| ATTEMPTS | 3 |
| ERROR_CONTEXT | `STEP16_CONTROLLED_FAIL attempt=3` (sanitized, no PII/secrets) |
| DUPLICATE_DLQ_ROWS | 0 |
| ACTIVE_RETRY_AFTER_DLQ | NO |

---

## 8. Operator Replay

| Field | Value |
|-------|-------|
| REPLAY_METHOD | `replayDeadLetterById(dlqId)` |
| ORIGINAL_EVENT_ID | `11087a8e-2a00-4e06-8e08-274e94203539` |
| REPLAY_EVENT_ID | `11087a8e-2a00-4e06-8e08-274e94203539` (identity preserved) |
| REPLAY_SUCCESS | YES (`CONSUMER_REPLAY_OK`) |
| CONSUMER_SUCCESS | YES |
| RECEIPT_CREATED | YES (1 ok receipt) |
| DLQ_RESOLVED | YES (`resolvedAt=2026-08-05T06:11:51.054Z`, `resolution=manual_replay`) |

---

## 9. Business Effect Idempotency

| Phase | Count |
|-------|-------|
| EFFECT_BEFORE | 0 |
| EFFECT_AFTER_FAILURES | 0 |
| EFFECT_AFTER_REPLAY | 1 (`step16.cert.success` audit) |
| EFFECT_AFTER_DUPLICATE_REPLAY | 1 |
| DUPLICATE_EFFECTS | 0 |

Equation: `0 → 0 (failures) → 1 (replay) → 1 (duplicate replay)`

---

## 10. Consumer Receipts

| Consumer | Failure deliveries | Success deliveries | Receipts | Duplicate effects |
|----------|-------------------|-------------------|----------|-------------------|
| step16.fail.v1 | 3 | 1 | 1 ok + 1 skipped(dlq) | 0 |

No false success receipt during failure phase.

---

## 11. Audit Trail

| Gate | Status |
|------|--------|
| FAILURE_AUDIT | PASS (logs + DLQ error preserved) |
| RETRY_AUDIT | PASS (attempt timestamps captured) |
| DLQ_AUDIT | PASS (DLQ row with error, attempts, timestamps) |
| OPERATOR_REPLAY_AUDIT | PASS_WITH_GAP (no operator WHO) |
| SUCCESS_AUDIT | PASS (receipt + business effect) |
| **AUDIT_GATE** | **PASS_WITH_GAP** |

---

## 12. Direct Dispatch Analysis

| Field | Value |
|-------|-------|
| NORMAL_OUTBOX_PATH | CERTIFIED |
| DIRECT_DISPATCH_PATH | Consumer retry + DLQ supported; no outbox retry envelope |
| DIRECT_DISPATCH_DLQ_BEHAVIOR | **SUPPORTED_WITH_LIMITATIONS** |
| PRODUCTION_CALL_SITES | 1 production runtime (`outbox-processor.ts`); remainder certification/replay |
| FIX_BEFORE_USE | YES — durable events MUST use transactional outbox |
| DECISION | PRODUCTION_OUTBOX_PATH=PASS; DIRECT_DISPATCH_DURABILITY=NOT_CERTIFIED |

---

## 13. Handler / Receipt Atomicity

| Field | Value |
|-------|-------|
| HANDLER_RECEIPT_ATOMICITY | NON_ATOMIC |
| CRASH_WINDOW | handler success → crash before `recordConsumerSuccess` → redelivery possible |
| BUSINESS_EFFECT_PROTECTION | receipt `@@unique([consumerName, eventId])` + domain idempotency |
| RESIDUAL_RISK | at-least-once; idempotent handlers required |

---

## 14. Metrics

| Metric | T0 | Peak | Final |
|--------|-----|------|-------|
| OUTBOX_PENDING | 0 | 1 | 0 |
| DLQ_UNRESOLVED | 0 | 1 | 0 |

No permanent metric leak observed.

---

## 15. Multi-instance

| Field | Value |
|-------|-------|
| MIN_INSTANCES | 2 |
| RETRY_DUPLICATES | 0 |
| REPLAY_DUPLICATES | 0 |
| MULTI_INSTANCE_GATE | PASS (SKIP LOCKED claim; cert job won claim race) |

---

## 16. Runtime Logs

| Check | Result |
|-------|--------|
| P2021 | 0 |
| P2022 | 0 |
| EXPECTED_FAILURE_LOGS | `event_consumer_failed` × 3 (STEP16_CONTROLLED_FAIL) |
| UNEXPECTED_CRITICAL_ERRORS | 0 |

---

## 17. Database Safety

| Field | Value |
|-------|-------|
| MIGRATIONS | 31/31 |
| NEW_MIGRATION | NO |
| SCHEMA_MODIFIED | NO |

---

## 18. Production Safety

| Check | Result |
|-------|--------|
| PRODUCTION_DEPLOYMENT | UNTOUCHED |
| PRODUCTION_MIGRATION | UNTOUCHED |
| PRODUCTION_DB_MODIFIED | UNTOUCHED |
| PRODUCTION_REDIS_MODIFIED | UNTOUCHED |
| PRODUCTION_EVENT_FLAGS_CHANGED | UNTOUCHED |
| PRODUCTION_CREDENTIALS_USED | NO |
| RAZORPAY_LIVE_USED | NO |

---

## 19. Evidence

| Field | Value |
|-------|-------|
| EVIDENCE_PATH | `docs/evidence/stage-e-step-16/` |
| SECRET_SCAN | PASS |
| PII_SCAN | PASS (synthetic `@homigo-staging.test` identifiers only) |

---

## 20. Final Reconciliation

| Metric | Value |
|--------|-------|
| EVENTS_GENERATED | 1 |
| EVENTS_PERSISTED | 1 |
| FAILED_ATTEMPTS | 3 |
| DLQ_CREATED | 1 |
| OPERATOR_REPLAYS | 1 |
| SUCCESSFUL_EFFECTS | 1 |
| LOST_EVENTS | 0 |
| STRANDED_EVENTS | 0 |
| DUPLICATE_EFFECTS | 0 |
| UNRESOLVED_DLQ_FINAL | 0 |

---

## 21. Final Gate

```
============================================================
HOMIGO PHASE 0 — STAGE E — STEP 16
============================================================
CONTROLLED CONSUMER FAILURE:          PASS
RETRY #1:                            PASS
BACKOFF:                             PASS
MAX ATTEMPTS:                        PASS
DLQ CREATION:                        PASS
EVENT DURABILITY:                    PASS
OPERATOR REPLAY:                     PASS
REPLAY SUCCESS:                      PASS
CONSUMER RECEIPT:                    PASS
BUSINESS EFFECT IDEMPOTENCY:         PASS
DUPLICATE EFFECTS:                   0
AUDIT TRAIL:                         PASS_WITH_GAP
OUTBOX DRAIN:                        PASS
DLQ RESOLUTION:                      PASS
MULTI-INSTANCE SAFETY:               PASS
DATABASE CONTENTION:                 PASS
DIRECT-DISPATCH BEHAVIOR:            SUPPORTED_WITH_LIMITATIONS
HANDLER/RECEIPT ATOMICITY:           NON_ATOMIC
MIGRATIONS:                          31/31
DATABASE SCHEMA CHANGE:              NONE
PRODUCTION:                          UNTOUCHED
CRITICAL FAILURES:                   0

STEP 16 — PASS_WITH_ARCHITECTURAL_LIMITATION
============================================================
```

---

## Certification Statement

On staging infrastructure at RC `c31f154`, the durable production outbox event path was proven to survive controlled consumer failure through bounded inline retry with exponential backoff, terminal DLQ creation, operator replay via `replayDeadLetterById`, exactly-once business effect after replay, and duplicate-replay idempotency. Failure ≠ event loss. Retry ≠ duplicate business effect. DLQ replay = recoverable event processing.

**Limitation:** Direct `dispatchEvent()` must not be used as a durable production delivery path — it lacks outbox-level retry scheduling. Only the transactional outbox path is certified for durable delivery.

**STEP 16 CERTIFIED.**  
**SAFE TO PREPARE STEP 17.**  
**STEP 17 WAS NOT EXECUTED.**
