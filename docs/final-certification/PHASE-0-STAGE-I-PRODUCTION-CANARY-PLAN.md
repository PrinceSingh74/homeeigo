# HOMIGO PHASE 0 — STAGE I

# PRODUCTION CANARY EXECUTION PLAN

**Document ID:** `PHASE-0-STAGE-I-001`  
**Classification:** Planning Only — **DO NOT EXECUTE WITHOUT HUMAN APPROVAL**  
**Certified Baseline RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Certified Image Digest:** `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32`  
**Stage H Result:** PASS (2026-08-06T18:32:17Z)  

---

> **⚠️ EXECUTION PROHIBITED**
>
> This document is a **production execution plan only**.
> No production deployment, migration, or feature flag activation has been performed.
> Await explicit human approval from CTO, DevOps, QA, Product, and Business stakeholders.

**Cross-references:**
[Stage H Regression Report](../evidence/stage-h-regression/STAGE-H-FINAL-REGRESSION-CERTIFICATION-REPORT.md) ·
[Production Promotion Runbook](../operations/PRODUCTION-PROMOTION-RUNBOOK.md) ·
[Rollback Runbook](../operations/ROLLBACK-RUNBOOK.md) ·
[Phase 0 Sign-Off](../final-certification/PHASE-0-SIGNOFF.md) ·
[ADR-012 Production Promotion Strategy](../architecture/adr-012-production-promotion-strategy.md)

---

## 1. Purpose

Define the **official production canary rollout** for promoting staging-certified RC `c31f154` to production using immutable digest pinning, phased event platform activation, and strict rollback criteria.

Stage I is **planning only**. Production remains untouched until all approval gates are satisfied.

---

## 2. Production Pre-Deployment Checklist

Complete **T−24h to T−0**. All items must be checked before deploy window opens.

### 2.1 Fresh Backup Verification

```powershell
$PROJECT = "<PRODUCTION_PROJECT>"
$INSTANCE = "<PRODUCTION_SQL_INSTANCE>"

gcloud sql backups list --instance=$INSTANCE --project=$PROJECT
gcloud sql instances describe $INSTANCE --project=$PROJECT `
  --format="yaml(settings.backupConfiguration,settings.deletionProtectionEnabled)"
```

| Check | Expected | Verified By | ☐ |
|-------|----------|-------------|---|
| Automated backups enabled | ON | DBA | ☐ |
| Retained backups | ≥ 7 | DBA | ☐ |
| Latest backup age | < 24 hours | DBA | ☐ |
| Deletion protection | ON | Platform | ☐ |

**Staging reference:** Restore tested in 488–589s — `docs/evidence/stage-c-step-4/staging-restore-certification.md`

### 2.2 PITR Verification

```powershell
gcloud sql instances describe $INSTANCE --project=$PROJECT `
  --format="value(settings.backupConfiguration.pointInTimeRecoveryEnabled)"
```

| Check | Expected | Verified By | ☐ |
|-------|----------|-------------|---|
| PITR enabled | true | DBA | ☐ |
| Transaction log retention | ≥ 7 days | DBA | ☐ |
| PITR window covers promotion window | confirmed | DBA | ☐ |

**Optional pre-flight clone (non-destructive):**

```powershell
$TS = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$TARGET = "${INSTANCE}-pre-promote-$(Get-Date -Format 'yyyyMMdd')"

gcloud sql instances clone $INSTANCE $TARGET `
  --project=$PROJECT `
  --point-in-time=$TS
```

Validate clone reaches RUNNABLE; delete after verification. **Do not attach clone to production traffic.**

### 2.3 Environment Verification

| Check | Action | Verified By | ☐ |
|-------|--------|-------------|---|
| Production GCP project provisioned | IAM roles assigned | Platform | ☐ |
| Cloud Run service exists | `homigo-backend-production` | Platform | ☐ |
| Cloud SQL PostgreSQL 16 | Backups + PITR + deletion protection | DBA | ☐ |
| Redis / Memorystore | Production instance ready | Platform | ☐ |
| VPC connector | Configured for private DB access | Platform | ☐ |
| DNS / load balancer | Production URL routes to Cloud Run | Platform | ☐ |
| Min/max instances | Set per capacity plan | SRE | ☐ |

### 2.4 Secret Verification

**Never copy staging secrets to production.**

| Secret | Production Name | Staging Reference | Verified By | ☐ |
|--------|-----------------|-------------------|-------------|---|
| Database URL | `PRODUCTION_DATABASE_URL` | `STAGING_DATABASE_URL` | Security | ☐ |
| Redis URL | `PRODUCTION_REDIS_URL` | `STAGING_REDIS_URL` | Security | ☐ |
| OPS auth token | `PRODUCTION_OPS_AUTH_TOKEN` | `STAGING_OPS_AUTH_TOKEN` | Security | ☐ |
| JWT secrets | `PRODUCTION_JWT_*` | `STAGING_JWT_*` | Security | ☐ |
| Encryption key | `PRODUCTION_ENCRYPTION_KEY` | `STAGING_ENCRYPTION_KEY` | Security | ☐ |
| Razorpay key ID | `PRODUCTION_RAZORPAY_KEY_ID` | `rzp_test_*` → **`rzp_live_*`** | Finance | ☐ |
| Razorpay key secret | LIVE secret | TEST secret | Finance | ☐ |
| Razorpay webhook secret | LIVE webhook secret | TEST webhook secret | Finance | ☐ |
| Resend API key | Production key | Staging key | Platform | ☐ |
| Grafana admin password | Production secret | Staging secret | SRE | ☐ |
| **Slack webhook** | **`PRODUCTION_SLACK_WEBHOOK_URL`** | **NOT on staging — REQUIRED** | SRE | ☐ |

### 2.5 Feature Flag Verification (Initial State — ALL OFF)

Before first production deploy, confirm all event flags are **OFF**:

| Variable | Initial Production Value | ☐ |
|----------|-------------------------|---|
| `EVENTS_OUTBOX_ENABLED` | `false` | ☐ |
| `EVENTS_CONSUMERS_ENABLED` | `false` | ☐ |
| `EVENTS_BOOKING_ENABLED` | `false` | ☐ |
| `EVENTS_PAYMENT_ENABLED` | `false` | ☐ |
| `EVENTS_PARTNER_ENABLED` | `false` | ☐ |
| `EVENTS_TRACKING_ENABLED` | `false` | ☐ |
| `STAGING_EVENTS_CERTIFICATION` | **must NOT be set** | ☐ |

### 2.6 Rollback Readiness

| Check | Action | Verified By | ☐ |
|-------|--------|-------------|---|
| Prior production revision recorded | `gcloud run revisions list` | Release Eng | ☐ |
| Prior revision digest documented | For traffic rollback | Release Eng | ☐ |
| Rollback runbook reviewed | `docs/operations/ROLLBACK-RUNBOOK.md` | On-call | ☐ |
| Emergency consumer disable procedure | Documented and tested in staging | SRE | ☐ |
| On-call rotation confirmed | Escalation contacts active | SRE | ☐ |
| Change advisory posted | Engineering + ops channels | Release Eng | ☐ |

---

## 3. Deployment Sequence

### Phase 0 — Identity Lock (T−0)

```powershell
$RC = "c31f154a128022fa7d9c4e44652506eedf3fa3e4"
$EXPECTED_DIGEST = "sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32"

# Record current production revision for rollback
gcloud run revisions list --service=homigo-backend-production `
  --region=asia-south1 --project=$PROJECT --limit=5
```

**Gate:** Block promotion if digest does not match certified build.

### Phase 1 — Database Migration (Human-Approved)

Execute only after DBA sign-off:

```bash
# Cloud Run Job with PRODUCTION_DATABASE_URL
prisma migrate deploy
prisma migrate status   # expect: 31/31 (or successor count)
```

| Gate | Expected |
|------|----------|
| Failed migrations | 0 |
| Migration status | Clean |

**Staging evidence:** Wave-1 clean replay 31/31 — `docs/evidence/stage-d/step-d-wave1-clean-replay-certification.md`

### Phase 2 — Deploy Certified Image (Events OFF)

Deploy by **immutable digest**, not floating tag:

```powershell
# Production deploy script (to be adapted from staging-gcp-deploy.ps1)
# Image: asia-south1-docker.pkg.dev/<PROJECT>/homigo/backend@sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32

# Initial env — legacy mode (events disabled)
EVENTS_OUTBOX_ENABLED=false
EVENTS_CONSUMERS_ENABLED=false
# All EVENTS_*_ENABLED=false
```

### Phase 3 — Health Verification

```powershell
$URL = "<PRODUCTION_SERVICE_URL>"
$TOKEN = gcloud secrets versions access latest --secret=PRODUCTION_OPS_AUTH_TOKEN --project=$PROJECT

curl -s "$URL/health" | jq .
curl -s -H "Authorization: Bearer $TOKEN" "$URL/ready"
curl -s -H "Authorization: Bearer $TOKEN" "$URL/metrics" | grep homigo_outbox_pending
```

| Endpoint | Expected |
|----------|----------|
| `/health` | HTTP 200, database=ok, redis=ok |
| `/ready` | HTTP 200 with OPS token |
| `/metrics` | HTTP 200; valid Prometheus format |

### Phase 4 — Post-Deploy Identity Verification

```powershell
gcloud run revisions describe <NEW_REVISION> `
  --region=asia-south1 --project=$PROJECT `
  --format="yaml(status.imageDigest,metadata.name)"
```

**Pass criteria:** Digest matches `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32`

---

## 4. Canary Rollout Strategy

### 4.1 Approach Selection

**If percentage-based traffic split is available (Cloud Run traffic splitting):**

| Stage | Traffic % | Duration | Gate |
|-------|-----------|----------|------|
| Canary 1 | 5% | 30 min | Health + metrics |
| Canary 2 | 10% | 30 min | Booking smoke |
| Canary 3 | 25% | 1 hour | Partner + notifications |
| Canary 4 | 50% | 2 hours | Full lifecycle |
| Canary 5 | 100% | ongoing | 24h monitoring |

```powershell
gcloud run services update-traffic homigo-backend-production `
  --to-revisions=<NEW_REVISION>=5,<PRIOR_REVISION>=95 `
  --region=asia-south1 --project=$PROJECT
```

**If percentage rollout is unavailable — domain-based activation:**

Activate event families sequentially on 100% traffic with monitoring between each step.

### 4.2 Event Platform Activation Order

**Keep all `EVENTS_*` flags OFF initially.** Activate in this order:

| Step | Activation | Risk Level | Monitoring Window |
|------|------------|------------|-------------------|
| 1 | `EVENTS_OUTBOX_ENABLED=true` | Low | 30 min — verify outbox writes, no consumer yet |
| 2 | `EVENTS_BOOKING_ENABLED=true` | Medium | 1 hour — booking lifecycle |
| 3 | `EVENTS_PARTNER_ENABLED=true` | Medium | 1 hour — dispatch + tracking |
| 4 | `EVENTS_TRACKING_ENABLED=true` | Low | 30 min — GPS events |
| 5 | Enable notifications (existing paths) | Medium | 1 hour — in-app + email |
| 6 | `EVENTS_CONSUMERS_ENABLED=true` | High | 2 hours — consumer processing |
| 7 | `EVENTS_PAYMENT_ENABLED=true` | **CRITICAL** | 4 hours — **LAST** |

> **Payments last** because they carry the highest financial risk.

Between each step:
- Confirm `homigo_outbox_pending = 0`
- Confirm `homigo_dlq_unresolved = 0`
- Confirm no error rate spike
- Confirm no duplicate business effects

### 4.3 Rollback Trigger During Canary

If any canary step fails, **stop progression** and evaluate rollback per §6.

---

## 5. Production Monitoring Checklist

Monitor continuously during canary and for **minimum 24 hours** post-100%.

### 5.1 Event Platform Metrics

| Metric | Threshold | Alert Rule |
|--------|-----------|------------|
| `homigo_outbox_pending` | ≤ 10 sustained | EventOutboxBacklogHigh |
| `homigo_outbox_oldest_pending_age_seconds` | < 300 | EventOutboxOldestPendingStale |
| `homigo_dlq_unresolved` | 0 unexpected growth | EventDlqGrowing |
| `homigo_consumer_failed_rate` | 0 sustained | EventConsumerFailureRateHigh |
| `homigo_consumer_retry_total` rate | No spike > 2× baseline | Manual watch |
| Processing latency (event p95) | < 100ms | Manual watch |

### 5.2 Infrastructure Metrics

| Metric | Threshold |
|--------|-----------|
| PostgreSQL CPU | < 70% sustained |
| PostgreSQL connections | < 80% max |
| PostgreSQL locks / deadlocks | 0 unexpected |
| Redis memory | < 80% max |
| Redis latency | < 10ms p95 |
| Cloud Run CPU | < 80% sustained |
| Cloud Run memory | No progressive growth |
| Cloud Run instance count | Within autoscaling bounds |

### 5.3 Business Metrics

| Metric | Threshold |
|--------|-----------|
| API error rate (5xx) | < 1% |
| Booking success rate | ≥ 99% (baseline T+0) |
| Payment success rate | ≥ 99% (baseline T+0) |
| Notification delivery failures | 0 unexpected spike |
| Duplicate business effects | **ZERO tolerance** |
| Financial reconciliation | Balanced after each payment test |

### 5.4 Monitoring Cadence

| Window | Activity |
|--------|----------|
| 0–2 hours | Active on-call; 5-min metric poll |
| 2–24 hours | Standard on-call; alert response |
| 24–72 hours | Elevated DLQ/outbox monitoring |
| 7 days | Weekly review of error rates and alert noise |

### 5.5 Dashboards and Alerts

| Resource | Requirement |
|----------|-------------|
| Grafana dashboard | `homigo-operations` (production folder) |
| Prometheus scrape | `up{job="homigo-backend-production"}=1` |
| Alertmanager | Slack + PagerDuty receivers configured |
| Test notification | Send to `#homigo-prod-alerts` before go-live |

**Staging gap to resolve:** Slack NOT_CONFIGURED on staging — **must be configured before production.**

---

## 6. Rollback Criteria

Initiate rollback if **any** of the following occur:

| Condition | Severity | Action |
|-----------|----------|--------|
| Migration failure or partial apply | CRITICAL | Stop deploy; assess PITR |
| `/health` not 200 for > 5 minutes | CRITICAL | Rollback revision |
| `homigo_outbox_pending` sustained > 100 | HIGH | Disable consumers; investigate |
| Unexplained DLQ growth (> 5 entries in 15 min) | HIGH | Disable consumers; investigate |
| Payment settlement inconsistency | CRITICAL | Halt payments; incident |
| Duplicate payment effects | CRITICAL | Halt payments; incident |
| Error rate > 5% on core API paths | HIGH | Rollback revision |
| Lost events detected (reconciliation) | CRITICAL | Halt consumers; incident |
| Data corruption suspected | CRITICAL | Invoke PITR procedure |
| Memory progressive growth > 20% in 1 hour | HIGH | Rollback revision |

### 6.1 Safe Rollback Sequence

1. **Shift Cloud Run traffic** to prior digest-pinned revision (100%).
2. **If migration caused issue:** forward-fix preferred; PITR clone for catastrophic failure.
3. **If uncontrolled DLQ growth:** set `EVENTS_CONSUMERS_ENABLED=false`.
4. **Drain outbox** before extended consumer disable.
5. **Notify stakeholders**; begin postmortem.
6. **Post-rollback verification:**
   - `/health` 200
   - Error rate returns to baseline
   - No new DLQ entries
   - Financial reconciliation clean

### 6.2 Rollback Commands

```powershell
# List revisions
gcloud run revisions list --service=homigo-backend-production `
  --region=asia-south1 --project=$PROJECT

# Route 100% traffic to prior revision
gcloud run services update-traffic homigo-backend-production `
  --to-revisions=<PRIOR_REVISION>=100 `
  --region=asia-south1 --project=$PROJECT

# Emergency: disable consumers (after outbox drain)
gcloud run services update homigo-backend-production `
  --update-env-vars="EVENTS_CONSUMERS_ENABLED=false" `
  --region=asia-south1 --project=$PROJECT
```

**Full procedure:** `docs/operations/ROLLBACK-RUNBOOK.md`

---

## 7. Final Production Approval Checklist

All approvals required **before** T−0 deploy window opens.

| # | Approver | Responsibility | Approval | Date |
|---|----------|----------------|----------|------|
| 1 | **CTO** | Production promotion authorized | ☐ GO / ☐ NO-GO | ________ |
| 2 | **DevOps / Platform** | Infrastructure + secrets ready | ☐ GO / ☐ NO-GO | ________ |
| 3 | **QA** | Stage H regression accepted | ☐ GO / ☐ NO-GO | ________ |
| 4 | **Product** | Business impact accepted | ☐ GO / ☐ NO-GO | ________ |
| 5 | **Business / Finance** | LIVE Razorpay + payment risk accepted | ☐ GO / ☐ NO-GO | ________ |
| 6 | **DBA** | Migration + backup/PITR verified | ☐ GO / ☐ NO-GO | ________ |
| 7 | **SRE** | Observability + alert routing operational | ☐ GO / ☐ NO-GO | ________ |
| 8 | **Release Engineering** | Deploy sequence reviewed | ☐ GO / ☐ NO-GO | ________ |

**Decision rule:** Any NO-GO reschedules promotion. Unanimous GO required.

---

## 8. Go / No-Go Gate (T−60 min)

| # | Item | Go | No-Go |
|---|------|-----|-------|
| 1 | Stage H regression PASS | ☐ | ☐ |
| 2 | Phase 0 sign-off obtained | ☐ | ☐ |
| 3 | Backups verified < 24h | ☐ | ☐ |
| 4 | PITR enabled | ☐ | ☐ |
| 5 | Production secrets provisioned | ☐ | ☐ |
| 6 | LIVE Razorpay approved by finance | ☐ | ☐ |
| 7 | Observability stack operational | ☐ | ☐ |
| 8 | Slack/PagerDuty tested | ☐ | ☐ |
| 9 | Rollback revision identified | ☐ | ☐ |
| 10 | On-call confirmed | ☐ | ☐ |
| 11 | Change advisory posted | ☐ | ☐ |
| 12 | Production freeze active | ☐ | ☐ |
| 13 | All EVENTS_* flags confirmed OFF | ☐ | ☐ |
| 14 | Certified digest verified in registry | ☐ | ☐ |

---

## 9. Success Criteria (Post-Promotion)

Promotion succeeds when **all** criteria met:

| # | Criterion |
|---|-----------|
| 1 | Deployed digest matches certified RC build |
| 2 | Migrations 31/31 — status clean |
| 3 | `/health` 200 for 2-hour monitoring window |
| 4 | `homigo_outbox_pending` = 0 at end of window |
| 5 | `homigo_dlq_unresolved` = 0 unexplained entries |
| 6 | No CRITICAL rollback conditions triggered |
| 7 | Smoke tests PASS (approved scope) |
| 8 | Alert routing confirmed operational |
| 9 | Post-deploy report filed within 24 hours |
| 10 | Evidence folder created: `docs/evidence/production-promote-<date>/` |

---

## 10. Incident Escalation

| Level | Contact | Trigger |
|-------|---------|---------|
| L1 | On-call SRE | Alert fires or smoke test failure |
| L2 | Backend Lead + DBA | Migration issue, outbox/DLQ anomaly |
| L3 | CTO + Release Engineering | Rollback decision, data integrity |
| L4 | CEO / Legal | Payment breach, data exposure |

---

## 11. Maintenance Window Schedule

Minimum **4-hour window**:

| Phase | Duration |
|-------|----------|
| Pre-deploy verification | 30 min |
| Migration + deploy | 45 min |
| Smoke tests | 30 min |
| Initial monitoring | 2 hours |
| Buffer | 15 min |

**Production freeze:** T−24h to T+4h — no non-emergency production changes.

---

## 12. Staging Certified Reference Values

For comparison during production validation (staging only):

| Metric | Staging @ Stage G/H |
|--------|---------------------|
| SOAK_DURATION_MINUTES | 62.3 |
| MEMORY_GROWTH_PCT | 2.5 |
| LOST_EVENTS | 0 |
| BOOKINGS_SUCCEEDED | 9/9 (soak) + 2/2 (Stage H smoke) |
| OUTBOX_FINAL | 0 |
| DLQ_FINAL | 0 |
| MIGRATIONS | 31/31 |
| RC SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## 13. Document Status

| Field | Value |
|-------|-------|
| Status | **PLANNING ONLY — NOT EXECUTED** |
| Production touched | **NO** |
| Migrations in production | **NO** |
| Event flags enabled in production | **NO** |
| Awaiting | Human approval |

---

**END OF PHASE 0**

Production canary execution awaits explicit human approval. Do not deploy.
