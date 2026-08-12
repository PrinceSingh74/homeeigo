# Enterprise Scalability Certification

**Executed:** 2026-08-07T06:05:15.517Z
**Run ID:** `scale-msijj6na`

## Pool audit


## Concurrent reschedule results

| Concurrent | Verdict | Success | P2037 | POOL_BUSY | Corrupt | Duplicates | Overlaps |
|------------|---------|---------|-------|-----------|---------|------------|----------|

## Remediation applied

- `reschedule-gate.ts` — semaphore backpressure (`RESCHEDULE_MAX_INFLIGHT=32`)
- `db-retry.ts` — P2037/P2034 retry (20 attempts, jittered backoff)
- `booking.service.ts` — outer `runRescheduleWithRetry`, deferred notifications
- `prisma-errors.ts` — `PrismaClientUnknownRequestError` write-conflict detection
- Shared Prisma singleton in adversarial fixtures (removed duplicate pool)
