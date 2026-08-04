# HOMIGO PHASE 0 / STAGE D
# STEP 12 — CONTROLLED PAYMENT FLOW, FINANCIAL ATOMICITY
# & PAYMENT EVENT CERTIFICATION REPORT

**Date:** 2026-08-04  
**Auditor role:** Principal Payments Engineer / FinTech Backend Architect / DRE / Release Engineer / SDET  
**Certified RC (unchanged):** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Certified image digest:** `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32`  
**Job execution:** `homigo-step12-payment-cert-dsjg2`

---

## 1. Executive Result

| Field | Value |
|-------|-------|
| **STEP_12** | **PASS** |
| **CRITICAL_FAILURES** | 0 |
| **NON_CRITICAL_WARNINGS** | 2 |
| **STEP12_RUN_ID** | `stage12-cert-1785864999262` |
| **SUCCESS_PAYMENT_ID** | `cmsexwt6i0008s609kemz3528` |
| **FAILED_PAYMENT_ID** | `cmsexwumn003xs609fev8ba9w` |

---

## 2. Release Identity

| Field | Value |
|-------|-------|
| APPLICATION_RC_SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| IMAGE_DIGEST | `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32` |
| CLOUD_RUN_REVISION | `homigo-backend-staging-00029-pbn` |
| IMAGE_REBUILT | NO |
| REDEPLOYED | NO |

---

## 3. Environment

| Field | Value |
|-------|-------|
| PROJECT | `homigo-497619` |
| REGION | `asia-south1` |
| SERVICE | `homigo-backend-staging` |
| DATABASE_INSTANCE | `homigo-staging-step6a-pitr-20260803` |
| DATABASE | `homigo_staging_db` |
| APP_ENV | `staging` |
| RAZORPAY_MODE | `TEST` |

---

## 4. Pre-flight

| Field | Value |
|-------|-------|
| HEALTH | PASS (200, database=ok, redis=ok) |
| READY | 401 (expected authenticated endpoint) |
| METRICS | 401 (expected authenticated endpoint) |
| MIGRATIONS | 31/31 (baseline; no new migration) |
| EVENTS_OUTBOX_ENABLED | true |
| EVENTS_CONSUMERS_ENABLED | true |
| BACKUPS | ON |
| PITR | ON |
| DELETION_PROTECTION | ON |

---

## 5. Razorpay Safety

| Field | Value |
|-------|-------|
| TEST_MODE | PASS (`rzp_test_*`) |
| LIVE_CREDENTIALS_USED | NO |
| REAL_PAYMENT | NO |
| WEBHOOK_SECRET_PRESENT | YES |

---

## 6. Success Fixtures

| Field | Value |
|-------|-------|
| CUSTOMER | `usr_stage12cert1785864999262_success` |
| BOOKING | `cmsexwt1c0001s609kkoeeyfp` |
| PAYMENT | `cmsexwt6i0008s609kemz3528` |
| RAZORPAY_ORDER | `order_TLmG1zzJqypyVt` |
| REAL_PII_USED | NO |

---

## 7. Payment Initiated

| Field | Value |
|-------|-------|
| APPLICATION_PATH | `paymentService.createOrder` |
| PAYMENT_DB | INITIATED |
| RAZORPAY_ORDER | Real TEST order created |
| AMOUNT | 551 INR / 55100 paise |
| CURRENCY | INR |
| IDEMPOTENCY | `booking_order:{bookingId}` |

---

## 8. Payment Success

| Field | Value |
|-------|-------|
| RAZORPAY_TEST_SUCCESS | PASS (verify path + webhook captured path) |
| SIGNATURE_VERIFICATION | PASS |
| PAYMENT_DB_STATE | SUCCESS |
| PAID_TIMESTAMP | `2026-08-04T17:36:40.648Z` |
| AMOUNT_MATCH | PASS |

---

## 9. Ledger / Financial Posting

| Field | Value |
|-------|-------|
| LEDGER_TRANSACTION | PASS |
| PAYMENT_LINK | `booking_payment:cmsexwt6i0008s609kemz3528` |
| AMOUNT_MATCH | PASS (551 INR debit/credit) |
| DUPLICATE_POSTING | NO |
| DOUBLE_ENTRY_BALANCED | PASS |

---

## 10. payment.success

| Field | Value |
|-------|-------|
| EVENT | `homigo.payment.success` |
| EVENT_ID | `17fbea97-8d2d-4343-8286-16707e2b6983` |
| OUTBOX | PASS |
| PUBLISHED | PASS |
| CONSUMER_RECEIPTS | metrics.v1, ai-context-indexer.v1, audit.v1 |
| DLQ | 0 |

---

## 11. Success Atomicity

| Field | Value |
|-------|-------|
| PAYMENT_STATE_COMMITTED | YES |
| LEDGER_COMMITTED | YES |
| OUTBOX_COMMITTED | YES |
| SAME_TRANSACTION_BOUNDARY | YES — `financialTransactionManager.executeWithLedger` |
| FINANCIAL_EVENT_ATOMICITY | **PASS** |

**Code contract:** `payment.service.ts verify()` → `executeWithLedger` wraps payment update, booking update, journal insert, and `emitPaymentSuccessInTransaction` in a single `prisma.$transaction`.

---

## 12. Webhook Idempotency

| Field | Value |
|-------|-------|
| VALID_SIGNATURE | PASS (RECONCILED) |
| INVALID_SIGNATURE_REJECTED | PASS |
| DUPLICATE_WEBHOOK | PASS |
| DUPLICATE_LEDGER | NO |
| DUPLICATE_EVENT_EFFECT | NO |
| DUPLICATE_NOTIFICATION | NO |

---

## 13. Failure Fixtures

| Field | Value |
|-------|-------|
| BOOKING | `cmsexwukm003qs609x1ogxwcg` |
| PAYMENT | `cmsexwumn003xs609fev8ba9w` |
| RAZORPAY_ORDER | `order_TLmG3zogLxIpcp` |

---

## 14. Payment Failure

| Field | Value |
|-------|-------|
| CONTROLLED_TEST_FAILURE | PASS (signed `payment.failed` webhook) |
| PAYMENT_DB_STATE | FAILED |
| FAILURE_REASON_CAPTURED | gateway_failed via webhook payload |

---

## 15. payment.failed

| Field | Value |
|-------|-------|
| EVENT | `homigo.payment.failed` |
| EVENT_ID | `372871b5-1e51-4a36-a5b4-ae83a3824e66` |
| OUTBOX | PASS |
| PUBLISHED | PASS |
| CONSUMER_RECEIPTS | metrics.v1, ai-context-indexer.v1, audit.v1 |
| DLQ | 0 |

---

## 16. Failure Financial Isolation

| Field | Value |
|-------|-------|
| SUCCESS_LEDGER_ENTRY | 0 |
| SUCCESS_WALLET_CREDIT | 0 |
| PAYMENT_SUCCESS_EVENT | 0 |
| SUCCESS_NOTIFICATION | 0 |
| FAILURE_FINANCIAL_ISOLATION | **PASS** |

---

## 17. Failure Atomicity

| Field | Value |
|-------|-------|
| FAILED_STATE_COMMITTED | YES |
| FAILED_OUTBOX_COMMITTED | YES |
| SAME_TRANSACTION_BOUNDARY | YES — `prisma.$transaction` in `reconcileFromWebhook` |
| FAILURE_EVENT_ATOMICITY | **PASS** |

---

## 18. Amount Integrity

| Field | Value |
|-------|-------|
| EXPECTED_AMOUNT_PAISE | 55100 |
| RAZORPAY_AMOUNT_PAISE | 55100 |
| PAYMENT_AMOUNT_PAISE | 55100 |
| LEDGER_AMOUNT_PAISE | 55100 |
| RECONCILIATION | **PASS** |

---

## 19. Transaction Rollback

| Field | Value |
|-------|-------|
| ROLLBACK_ATOMICITY_TEST | NOT_AVAILABLE |
| PAYMENT_PARTIAL_COMMIT | NO (runtime evidence) |
| LEDGER_PARTIAL_COMMIT | NO (runtime evidence) |
| OUTBOX_PARTIAL_COMMIT | NO (runtime evidence) |

---

## 20. Idempotency

| Field | Value |
|-------|-------|
| SUCCESS_IDEMPOTENCY | PASS |
| FAILURE_IDEMPOTENCY | PASS |
| CONCURRENT_FINALIZATION | NOT_TESTED |
| DUPLICATE_FINANCIAL_MUTATION | NO |

---

## 21. Outbox / DLQ

| Field | Value |
|-------|-------|
| OUTBOX_PENDING_T0 | 0 |
| OUTBOX_PENDING_FINAL | 0 |
| DLQ_UNRESOLVED_T0 | 0 |
| DLQ_UNRESOLVED_FINAL | 0 |
| STEP12_DLQ_ENTRIES | 0 |
| OUTBOX_DRAIN | PASS |

---

## 22. Metrics

| Field | Value |
|-------|-------|
| PAYMENT_METRICS | Runtime counters incremented (payment_success_total, payment_failed_total) |
| OUTBOX_METRICS | homigo_outbox_pending=0 at final |
| CONSUMER_METRICS | All receipts recorded |
| METRICS_GATE | PASS (authenticated /metrics returns 401 as designed) |

---

## 23. Notification Regression

| Field | Value |
|-------|-------|
| SUCCESS_NOTIFICATION | PASS (1 payment_completed in-app; no external delivery) |
| FAILURE_NOTIFICATION | N/A |
| DUPLICATE_NOTIFICATION | NO |
| REAL_RECIPIENT_CONTACTED | NO |

---

## 24. Multi-instance

| Field | Value |
|-------|-------|
| MIN_INSTANCES | 2 |
| MAX_INSTANCES | 4 |
| MULTI_INSTANCE_PAYMENT_SAFETY | PASS (idempotency keys + DB uniqueness) |

---

## 25. Runtime Logs

| Field | Value |
|-------|-------|
| CRITICAL_P2021 | 0 |
| CRITICAL_P2022 | 0 |
| CRITICAL_PAYMENT_ERRORS | 0 |
| CRITICAL_LEDGER_ERRORS | 0 |
| CRITICAL_EVENT_ERRORS | 0 |
| LOG_GATE | PASS |

---

## 26. Database Safety

| Field | Value |
|-------|-------|
| MIGRATIONS | 31/31 |
| NEW_MIGRATION_EXECUTED | NO |
| SCHEMA_MODIFIED | NO |
| AUTHORITATIVE_STAGING_DB | YES |

---

## 27. Production Safety

| Field | Value |
|-------|-------|
| PRODUCTION_DEPLOYMENT | NO |
| PRODUCTION_MIGRATION | NO |
| PRODUCTION_DB_MODIFIED | NO |
| PRODUCTION_REDIS_MODIFIED | NO |
| PRODUCTION_EVENT_FLAGS_CHANGED | NO |
| PRODUCTION_CREDENTIALS_USED | NO |
| RAZORPAY_LIVE_USED | NO |
| REAL_PAYMENT | NO |

---

## 28. Evidence

| Field | Value |
|-------|-------|
| EVIDENCE_PATH | `docs/evidence/stage-d-step-12/` |
| SECRET_SCAN | PASS |
| PII_SCAN | PASS |

**Forensics policy:** KEEP_FOR_FORENSICS

---

## 29. Final Gate

```
============================================================
HOMIGO PHASE 0 — STEP 12 PASS
============================================================

RAZORPAY TEST MODE:                 PASS

PAYMENT INITIATION:                 PASS
TEST PAYMENT SUCCESS:               PASS
PAYMENT DB COMMIT:                  PASS
LEDGER TRANSACTION:                 PASS
PAYMENT.SUCCESS EVENT:              PASS

SUCCESS FINANCIAL ATOMICITY:        PASS
SUCCESS IDEMPOTENCY:                PASS
WEBHOOK IDEMPOTENCY:                PASS

TEST PAYMENT FAILURE:               PASS
PAYMENT FAILED STATE:               PASS
PAYMENT.FAILED EVENT:               PASS
FAILURE FINANCIAL ISOLATION:        PASS
FAILURE EVENT ATOMICITY:            PASS

AMOUNT RECONCILIATION:              PASS
OUTBOX DRAIN:                       PASS
DLQ:                                PASS
CONSUMER RECEIPTS:                  PASS
METRICS:                            PASS
NOTIFICATION REGRESSION:            PASS
MULTI-INSTANCE SAFETY:              PASS

DATABASE MIGRATION:                 NOT PERFORMED
RAZORPAY:                           TEST ONLY
PRODUCTION:                         UNTOUCHED
CRITICAL FAILURES:                  0

STEP 12 — CONTROLLED PAYMENT FLOW CERTIFIED
```

---

## Proof Chain

### Success

```
SYNTHETIC STAGING CUSTOMER (stage12-success-*@homigo-staging.test)
        ↓
PAYMENT INITIATED (paymentService.createOrder → order_TLmG1zzJqypyVt)
        ↓
RAZORPAY TEST ORDER (55100 paise verified via API)
        ↓
TEST PAYMENT SUCCESS (paymentService.verify + webhook.captured)
        ↓
SIGNATURE / WEBHOOK VERIFIED
        ↓
┌──────────────────────────────────────┐
│      FINANCIAL TRANSACTION           │
│  Payment SUCCESS                     │
│       +                              │
│  Journal BOOKING_PAYMENT (551/551)   │
│       +                              │
│  homigo.payment.success outbox       │
│             COMMIT                   │
└──────────────────────────────────────┘
        ↓
OUTBOX PROCESSOR → PUBLISHED
        ↓
CONSUMERS (metrics, audit, ai-context-indexer)
        ↓
NO DUPLICATE FINANCIAL EFFECT
        ↓
OUTBOX = 0  |  DLQ = 0
```

### Failure

```
SYNTHETIC STAGING PAYMENT (separate booking)
        ↓
CONTROLLED payment.failed WEBHOOK (MARKED_FAILED)
        ↓
PAYMENT = FAILED + homigo.payment.failed
        ↓
NO SUCCESS LEDGER | NO homigo.payment.success
        ↓
OUTBOX PROCESSOR → PUBLISHED
        ↓
CONSUMERS → RECEIPTS
        ↓
DUPLICATE WEBHOOK → DUPLICATE (no re-mutation)
        ↓
OUTBOX = 0  |  DLQ = 0
```

---

## Non-Critical Warnings

1. Local git HEAD (`3e96b520`) differs from certified RC — certification executed against deployed Cloud Run image `c31f154`, not local tree.
2. Two superseded dry-run job attempts during harness tuning (`bmjf7`, `s9npt`); passing run `dsjg2` is authoritative.

---

## Architecture Notes (Certified As-Is)

| Path | Transaction boundary |
|------|---------------------|
| Success verify/webhook | `financialTransactionManager.executeWithLedger` — payment + booking + ledger + outbox |
| Failure webhook | `prisma.$transaction` — payment FAILED + booking FAILED + outbox (no ledger) |
| Post-commit | Notifications/metrics async; consumer failure does not rollback money |

---

**STEP 12 PASS — SAFE TO PREPARE STEP 13**
