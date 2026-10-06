# Enterprise Scalability Certification

**Executed:** 2026-10-06T08:14:24.088Z
**Run ID:** `scale-muweiuei`

## Pool audit

- **prismaConnectionLimit:** 5
- **prismaPoolTimeoutSec:** 30
- **rescheduleMaxInflight:** 32
- **postgresMaxConnections:** 100

## Concurrent reschedule results

| Concurrent | Verdict | Success | P2037 | POOL_BUSY | Corrupt | Duplicates | Overlaps |
|------------|---------|---------|-------|-----------|---------|------------|----------|
| 100 | **PASS** | 100/100 (100%) | 0 | 0 | 0 | 0 | 0 |
| 250 | **PASS** | 250/250 (100%) | 0 | 0 | 0 | 0 | 0 |
| 500 | **PASS** | 500/500 (100%) | 0 | 0 | 0 | 0 | 0 |

## Remediation applied

- `reschedule-gate.ts` — semaphore backpressure (`RESCHEDULE_MAX_INFLIGHT=32`)
- `db-retry.ts` — P2037/P2034 retry (20 attempts, jittered backoff)
- `booking.service.ts` — outer `runRescheduleWithRetry`, deferred notifications
- `prisma-errors.ts` — `PrismaClientUnknownRequestError` write-conflict detection
- Shared Prisma singleton in adversarial fixtures (removed duplicate pool)
