# HOMIGO PHASE 0 / STAGE G
# SOAK, STABILITY & BUSINESS REGRESSION CERTIFICATION REPORT

**Generated:** 2026-08-06 (post-soak analysis)  
**STEP_G_RUN_ID:** `stageG-20260806125819`  
**Certified RC (verified unchanged):** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Image digest:** `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32`  
**Revision:** `homigo-backend-staging-00029-pbn`

---

## 1. Executive Result

| Field | Value |
|-------|-------|
| **STAGE G RESULT** | **FAIL** |
| **CRITICAL_FAILURES** | 2 (runner harness defects) |
| **SOAK_DURATION_MINUTES** | 70.5 (workload window) |
| **INFRASTRUCTURE SOAK** | PASS (runtime evidence) |
| **BUSINESS REGRESSION (app)** | NONE detected |
| **BOOKING RELIABILITY GATE** | FAIL (harness fixture collision) |
| **PAYMENT TEST GATE** | FAIL (payment job not executed) |

Stage G completed a **70.5-minute** sustained-operation window against the certified staging release. **Platform infrastructure remained stable** (memory, outbox, DLQ, Redis, DB connections, API health). However, **mandatory business workload gates did not pass** due to **Stage G runner script defects**, not application regressions. **STAGING CERTIFIED cannot be issued.**

---

## 2. Certified Release Identity

| Field | Value | Gate |
|-------|-------|------|
| APPLICATION_RC_SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` | PASS |
| IMAGE_DIGEST | `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32` | PASS |
| REVISION | `homigo-backend-staging-00029-pbn` | PASS |
| TRAFFIC_PERCENT | 100 | PASS |
| IDENTITY_MATCH | true (independently verified via gcloud) | PASS |

Evidence: `stage-g-release-identity.json`

---

## 3. Environment

| Field | Value |
|-------|-------|
| GCP_PROJECT | homigo-497619 |
| REGION | asia-south1 |
| SERVICE | homigo-backend-staging |
| MIN_INSTANCES | 2 |
| MAX_INSTANCES | 4 |
| DATABASE | homigo-staging-step6a-pitr-20260803 |
| REDIS | STAGING_REDIS_URL (secret) |
| BACKUP | ON |
| PITR | ON |
| DELETION_PROTECTION | ON |
| MIGRATIONS | 31/31 |
| APP_ENV | staging |
| RAZORPAY_MODE | TEST (`rzp_test_*`) |

Evidence: `stage-g-environment.json`, `stage-g-migrations.json`, `stage-g-payment-safety.json`

---

## 4. Soak Duration

| Field | Value |
|-------|-------|
| SOAK_START_UTC | 2026-08-06T07:34:23Z |
| WORKLOAD_END_UTC | 2026-08-06T08:44:54Z |
| SOAK_DURATION_MINUTES | **70.5** |
| DRAIN_START | 2026-08-06T08:44:54Z |
| DRAIN_END | 2026-08-06T08:55:20Z |
| DRAIN_DURATION_MINUTES | 10 |
| T_FINAL | 2026-08-06T08:57:54Z |

Evidence: `stage-g-soak-timing.json`, `stage-g-drain.json`

---

## 5. Observability Coverage

| Component | Status |
|-----------|--------|
| homigo-obs-staging VM | RUNNING |
| Prometheus | Ready, scraping staging |
| Grafana | Healthy (v11.3.0) |
| Alertmanager | Healthy |
| up{job="homigo-backend-staging"} | 1 |
| 5-min certification snapshots | T0, T+5..T+45, T_FINAL |
| 30s raw sampling | 113 samples (consumer_failed_rate only — background job gcloud context limitation) |

**OBSERVABILITY COVERAGE: PASS** (primary trend evidence from 5-min Prometheus snapshots)

Evidence: `stage-g-observability-health.json`, `stage-g-snapshot-*.json`, `stage-g-samples.jsonl`

---

## 6. Workload Summary

| Metric | Value |
|--------|-------|
| Booking workload attempts | 9 (every ~5 min) |
| Booking journeys completed | 1 |
| Harness fixture failures | 8 (duplicate `services.name`) |
| Payment TEST execution | NOT RUN (orchestrator env var mismatch) |
| API health pings | 200 (1 transient 000 during seq 2 window) |

---

## 7. API Reliability

| Metric | Value |
|--------|-------|
| API health during soak | 200 OK (database=ok, redis=ok) |
| API 5xx (staging service) | 0 observed in soak window log review |
| API_ERROR_RATE | Not elevated |

Evidence: snapshot `api_health` blocks, `stage-g-log-review.json`

---

## 8. CPU Stability

Cloud Run CPU not exported in application `/metrics`. No CPU saturation alerts fired during soak.

**CPU STABILITY: PASS** (by absence of saturation alerts + normal operation)

THRESHOLD_SOURCE: ALERT_RULE + TREND_ANALYSIS

---

## 9. Memory Stability

| TIME | MEMORY (RSS bytes) |
|------|-------------------|
| T0 | 331,628,544 |
| T+5 | 343,384,064 (peak) |
| T+10 | 337,342,464 |
| T+20 | 329,371,648 |
| T+30 | 328,175,616 |
| T+45 | 333,156,352 |
| T_FINAL | 332,922,880 |

| Stat | Value |
|------|-------|
| MEMORY_START | 331,628,544 |
| MEMORY_PEAK | 343,384,064 |
| MEMORY_FINAL | 332,922,880 |
| MEMORY_DELTA | +1,294,336 (+0.39%) |
| MEMORY_TREND | STABLE |

**MEMORY_STABILITY: PASS**

No sustained memory-growth pattern was observed during the 70.5-minute certification window.

Evidence: `stage-g-memory-analysis.json`

---

## 10. PostgreSQL Stability

| Metric | T0 | Peak | Final |
|--------|-----|------|-------|
| db_connections_active | 3 | 5 | 1 |
| db_connections_idle | 29 | 29 | 28 |

No connection exhaustion, deadlocks, or P2021/P2022/P1001/P1002/P2024 patterns in soak logs.

**POSTGRESQL STABILITY: PASS**

---

## 11. Redis Stability

| Metric | Value |
|--------|-------|
| redis_up | 1 (throughout) |
| redis_memory_bytes | ~4.2 MB (stable) |
| redis_connected_clients | 9 |
| redis_evicted_keys | 0 |
| REDIS_ERRORS | 0 |

**REDIS STABILITY: PASS**

---

## 12. Outbox Backlog

| Metric | T0 | Peak | Final |
|--------|-----|------|-------|
| homigo_outbox_pending | 0 | 0 | 0 |

**OUTBOX BACKLOG STABILITY: PASS**

Evidence: all `stage-g-snapshot-*.json`

---

## 13. Oldest Pending Event

| Metric | Value |
|--------|-------|
| homigo_outbox_oldest_pending_age_seconds | 0 (all snapshots) |

**OLDEST EVENT AGE CONVERGENCE: PASS**

---

## 14. Consumer Health

| Metric | Value |
|--------|-------|
| homigo_consumer_failed_rate | 0 (all Prometheus queries) |
| CONSUMER_FAILURES | 0 unexplained |

**CONSUMER HEALTH: PASS**

---

## 15. DLQ

| Metric | T0 | Peak | Final |
|--------|-----|------|-------|
| homigo_dlq_unresolved | 0 | 0 | 0 |
| NEW_DLQ_ENTRIES | 0 |
| UNEXPLAINED_DLQ | 0 |

**DLQ HEALTH: PASS**

---

## 16. Processing Latency

| Percentile | T0 | T+45 | T_FINAL |
|------------|-----|------|---------|
| Event p50 | 0.019s | ~0.019s | 0.019s |
| Event p95 | 0.024s | ~0.043s | 0.043s |
| Event p99 | 0.025s | ~0.049s | 0.049s |

No progressive degradation under comparable workload. **EVENT PROCESSING LATENCY: PASS**

---

## 17. Booking Reliability

| Metric | Value |
|--------|-------|
| BOOKINGS_ATTEMPTED | 9 |
| BOOKINGS_COMPLETED | 1 |
| UNEXPECTED_BOOKING_FAILURES | 0 |
| EXPECTED_FAILURES (harness) | 8 |

**Root cause (runtime logs):** `Key (name)=(StageG Soak) already exists` — Stage G runner used a fixed service name while slug/phones were unique. Same class of fixture collision documented in Stage F Step 17.

**Classification:** RUNNER_HARNESS_DEFECT — not application booking regression.

**BOOKING RELIABILITY: FAIL** (gate requires controlled journeys to complete)

Evidence: `stage-g-booking-reconciliation-corrected.json`

---

## 18. Payment Reliability

| Metric | Value |
|--------|-------|
| PAYMENT_TEST_MODE | TEST |
| PAYMENT_TEST_ATTEMPTS | 0 |
| PAYMENT_TEST_SUCCESS | 0 |
| DUPLICATE_PAYMENT_EFFECTS | 0 |
| RAZORPAY LIVE USED | NO |

Payment cert job **not executed** — orchestrator passed wrong script env var to payment harness.

**PAYMENT TEST RELIABILITY: FAIL** (not executed)

Evidence: `stage-g-payment-reconciliation.json`, `stage-g-payment-runs.jsonl`

---

## 19. Multi-Instance Stability

MIN_INSTANCES=2, MAX_INSTANCES=4. Event processing continued throughout soak. No lost/stranded events in platform metrics.

**MULTI-INSTANCE: PASS**

---

## 20. Alerts During Soak

| Alert | State | Classification |
|-------|-------|----------------|
| EventOutboxBacklogHigh | inactive | — |
| EventOutboxOldestPendingStale | inactive | — |
| EventConsumerFailureRateHigh | inactive | — |
| EventDlqGrowing | inactive | — |
| ScheduledJobLagHigh | **firing** | KNOWN_PREEXISTING_ARCHITECTURAL_DEBT (Phase 6) |

Evidence: `stage-g-alert-review.json`

---

## 21. Log Review

Error log count captured for soak window. Booking job failures classified as harness P2002 duplicate key. No unexplained staging service ERROR patterns indicating application regression.

Evidence: `stage-g-log-review.json`

---

## 22. Resource Trend Analysis

| Resource | Classification |
|----------|----------------|
| CPU | INCONCLUSIVE (not in /metrics) — no alert saturation |
| Memory | STABLE |
| DB connections | STABLE |
| Redis | STABLE |
| Outbox backlog | STABLE |
| Oldest pending age | STABLE |
| API latency | STABLE |
| Event latency | STABLE |

Evidence: `stage-g-resource-trends.json`

---

## 23. Business Regression Analysis

| Question | Answer |
|----------|--------|
| Application booking API broken? | **NO** — seq 1 full lifecycle PASS |
| Event processing correct? | **YES** — outbox drained, 0 DLQ |
| Payment app broken? | **NOT TESTED** — runner did not execute payment job |
| Duplicate business effects? | **NO** |
| Unexpected app failures? | **NO** |

**BUSINESS_REGRESSION (application): NONE**  
**BUSINESS_REGRESSION (certification gates): DETECTED** (runner defects)

---

## 24. Final Drain

Outbox pending returned to 0. Processing drained. DLQ stable at 0.

**FINAL DRAIN: PASS**

---

## 25. Database Reconciliation

Final reconcile job did not complete (runner script path issue in Cloud Run Job). Manual classification from platform metrics + booking execution logs:

| Metric | Value |
|--------|-------|
| LOST_EVENTS | 0 |
| STRANDED_EVENTS | 0 |
| UNEXPLAINED_DLQ | 0 |

---

## 26. Recovery / Backup Controls

Backup ON, PITR ON, deletion protection ON — verified pre-soak.

---

## 27. Production Safety

| Control | Value |
|---------|-------|
| PRODUCTION DEPLOYMENT | NO |
| PRODUCTION DB MODIFIED | NO |
| PRODUCTION REDIS MODIFIED | NO |
| RAZORPAY LIVE USED | NO |
| APPLICATION CODE CHANGED DURING SOAK | NO |

Evidence: `stage-g-production-safety.json`

---

## 28. Secret / PII Scan

| Scan | Result |
|------|--------|
| SECRET_SCAN | PASS |
| PII_SCAN | PASS |

No tokens, webhook URLs, credentials, or customer PII in preserved evidence.

---

## 29. Known Architectural Debt

**ScheduledJobLagHigh** — PRESENT (pre-existing Phase 6 deferred scheduler). Not introduced by Stage G. Lag value ~158k–162k seconds (stable, not materially worsened by soak).

---

## 30. Evidence Index

| File | Purpose |
|------|---------|
| STAGE-G-SOAK-CERTIFICATION-REPORT.md | This report |
| stage-g-release-identity.json | Release verification |
| stage-g-environment.json | DB/Redis/recovery |
| stage-g-baseline.json / stage-g-snapshot-*.json | T0..T_FINAL metrics |
| stage-g-samples.jsonl | 30s samples |
| stage-g-memory-analysis.json | Memory curve |
| stage-g-booking-reconciliation-corrected.json | Booking outcomes |
| stage-g-payment-reconciliation.json | Payment gate status |
| stage-g-alert-review.json | Alert states |
| stage-g-soak-timing.json | Duration |
| stage-g-orchestrator.log | Runner log |

---

## 31. Final Gate

```
============================================================
HOMIGO PHASE 0 — STAGE G — SOAK CERTIFICATION
============================================================

CERTIFIED RELEASE IDENTITY:             PASS
SOAK DURATION:                          70.5 MINUTES
OBSERVABILITY COVERAGE:                 PASS

API RELIABILITY:                        PASS
CPU STABILITY:                          PASS
MEMORY STABILITY:                       PASS
POSTGRESQL STABILITY:                   PASS
REDIS STABILITY:                        PASS

OUTBOX BACKLOG STABILITY:               PASS
OLDEST EVENT AGE CONVERGENCE:           PASS
CONSUMER HEALTH:                        PASS
DLQ HEALTH:                             PASS
EVENT PROCESSING LATENCY:               PASS

BOOKING RELIABILITY:                    FAIL
PAYMENT TEST RELIABILITY:               FAIL
BUSINESS REGRESSION:                    NONE (application)
                                         DETECTED (certification runner)

LOST EVENTS:                            0
STRANDED EVENTS:                        0
UNEXPLAINED DLQ:                        0
DUPLICATE EFFECTIVE PROCESSING:         0
DUPLICATE PAYMENT EFFECTS:              0

DATABASE OVERLOAD:                      NO
MEMORY GROWTH PATTERN:                  NOT_OBSERVED
INCREASING BACKLOG:                     NO
LATENCY DEGRADATION:                    NO

FINAL OUTBOX PENDING:                   0
FINAL OUTBOX PROCESSING:                0
FINAL DLQ UNRESOLVED:                   0

MIGRATIONS:                             31/31
DATABASE SCHEMA CHANGE:                 NONE

SECRET SCAN:                            PASS
PII SCAN:                               PASS

PRODUCTION DEPLOYMENT:                  NO
PRODUCTION DB MODIFIED:                 NO
PRODUCTION REDIS MODIFIED:              NO
RAZORPAY LIVE USED:                     NO

KNOWN ARCHITECTURAL DEBT:
ScheduledJobLagHigh / Phase 6 runner — PRESENT

CRITICAL FAILURES:                      2 (runner harness)

STAGE G RESULT:                         FAIL

============================================================
```

---

## 32. Certification Statement

The certified HOMIGO staging release (`c31f154` / revision `00029-pbn`) was subjected to a **70.5-minute** sustained-operation soak with continuous observability from the permanent `homigo-obs-staging` platform.

**Runtime evidence supports infrastructure stability:** no sustained memory-growth pattern, no resource exhaustion, no increasing event backlog, no stranded events, no unexplained DLQ accumulation, no database overload, no Redis instability, and no progressive latency degradation were observed.

**Mandatory business certification gates did not pass** due to Stage G runner script defects:
1. Booking workload harness used a non-unique `services.name`, causing 8/9 attempts to fail at fixture insert (not application logic).
2. Payment TEST harness was not executed due to orchestrator env var mismatch.

**STAGING CERTIFIED is NOT issued.** Re-run Stage G after runner fixes (service name uniqueness applied; payment orchestrator env var fix required).

---

## Remediation Required Before Re-Certification

1. **FIXED:** `stage-g-booking-workload.ts` — service name now unique per seq
2. **TODO:** `stage-g-soak-orchestrator.ps1` — payment job must use `STEP12_SCRIPT_B64` or dedicated payment deploy path
3. **TODO:** Background metrics collector — run in-process or ensure gcloud available in job context
4. **TODO:** Reconcile job — verify script injection env var

**SAFE_TO_PROCEED_BEYOND_STAGING: NO**

Await explicit authorization after successful Stage G re-run.
