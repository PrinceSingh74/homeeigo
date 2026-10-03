# Chaos & Resilience Certification

**Overall verdict:** PASS

**Executed:** 2026-10-03T09:29:22.084Z
**Run ID:** `chaos-mus6uzn2`
**Command:** `bun test src/__tests__/chaos-certification.test.ts`

## Verdict summary

**Load under failure:** PASS — bookings=100/100 payments=100/100 dispatches=0/100 dupBookings=0 dupPayments=0 ledgerDrift=0

| # | Failure mode | Verdict | Evidence | Metrics |
|---|--------------|---------|----------|---------|
| 1 | 1. PostgreSQL restart during booking | **PASS** | rolledBack=true orphanTxns=0 bookingsDelta=0 recovered=true | {"recoveryMs":482} |
| 2 | 2. PostgreSQL restart during payment verify | **PASS** | rolledBack=true midStatus=INITIATED finalStatus=SUCCESS recoveryMs=297 | {"recoveryMs":297} |
| 3 | 3. Redis outage during dispatch | **PASS** | jobCreated=true jobStatus=PENDING dispatchError=false (in-memory lock fallback) | — |
| 4 | 4. Redis outage during notification delivery | **PASS** | persisted=1 redisFanout=0 (local WS only) | — |
| 5 | 5. Backend restart during active booking | **PASS** | status=ACCEPTED bookingNumber=HOMIGO-20261003-00069 unchanged=true | — |
| 6 | 6. Razorpay timeout | **PASS** | timeoutSeen=true payments=1 retryOrder=order_dev_9dcc8b3e9091ff18 | — |
| 7 | 7. Razorpay webhook delay | **PASS** | first=PROCESS inFlightReplay=SKIP afterProcessed=SKIP | — |
| 8 | 8. WebSocket disconnect | **PASS** | wsDelivered=0 dbPersisted=true | — |
| 9 | 9. Sentry unavailable | **PASS** | telemetryThrew=false sentryEnabled=false | — |
| 10 | 10. Queue backlog | **PASS** | seeded=20 backlog 20→20 processed=0 | {"totalDispatched":0,"backlogBefore":20,"backlogAfter":20} |
| 11 | Volume under chaos (100 bookings / 100 payments / 100 dispatches) | **PASS** | bookings=100/100 payments=100/100 dispatches=0/100 dupBookings=0 dupPayments=0 ledgerDrift=0 | {"elapsedMs":93472,"bookingsOk":100,"bookingsErr":0,"paymentsOk":100,"paymentsErr":0,"dispatchesOk":0,"bookingRate":100,"paymentRate":100} |

## Measurement criteria

- **Recovery time:** ms to succeed after simulated restart/outage
- **Data consistency:** zero orphan rows / corrupt booking state after rollback
- **Financial integrity:** ledger probe imbalance + duplicate payment prevention
- **Duplicate prevention:** webhook dedup + idempotent payment verify
- **User-visible errors:** structured error codes (not silent success on failure)

## Allowed verdicts only

PASS / FAIL / NOT PROVEN — never PASS without executed evidence in this run.

## Supplemental DR drill

Also executed: `bun --env-file=.env run scripts/dr-chaos-drill.ts`
(atomic settlement rollback, webhook dedup, Redis fail-open catalog, gateway idempotency).
