# Scheduled Job Lag — Root Cause Analysis

**Date:** 2026-08-05  
**Alert:** `ScheduledJobLagHigh`  
**Metric:** `homigo_scheduled_job_lag_seconds` ≈ 72,000–73,000s (~20h)

## Classification

**NON_BLOCKING architectural debt** — not a crash, scheduler outage, or data corruption.

## Root cause

The automation scheduler **creates** `scheduledJob` rows on `booking.completed` but the **execution engine is deferred to Phase 6**.

Evidence in codebase:

```typescript
// apps/backend/src/events/consumers/automation-scheduler.consumer.ts
// execution engine deferred to Phase 6
```

Forensics job (`stage-f-scheduled-job-forensics.ts`) confirmed **4 overdue `automation.review_request` jobs** with lag ~72,251s.

## Impact

- `homigo_scheduled_job_lag_seconds` reflects real pending jobs that will never run until Phase 6
- `ScheduledJobLagHigh` remains **firing/pending** on permanent Prometheus
- Does not block event outbox, consumer, or DLQ certification paths

## Remediation

| Action | Owner | Status |
|--------|-------|--------|
| Implement Phase 6 scheduled job runner | Platform/Backend | Deferred |
| Staging alert suppression for known debt | SRE | Optional — not applied (threshold not lowered) |
| Synthetic overdue job cleanup after cert | Cert harness | Done via `step18_` prefix cleanup |

## Blocking?

**NON_BLOCKING** for Stage F remediation completion with documented limitation.
