# Production Promotion Runbook

**Document ID:** `OPS-RUNBOOK-PROD-PROMOTE-001`  
**Version:** 1.0  
**Effective Date:** 2026-08-06  
**Owner:** Release Engineering  
**Certified Baseline RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`

**Cross-references:**
[ADR-012 Production Promotion Strategy](../architecture/adr-012-production-promotion-strategy.md) ·
[Release Notes RC c31f154](../release/RELEASE-NOTES-RC-c31f154.md) ·
[Rollback Runbook](./ROLLBACK-RUNBOOK.md) ·
[Phase 0 Production Checklist](../final-certification/PHASE-0-PRODUCTION-READINESS-CHECKLIST.md) ·
[Phase 0 Sign-Off](../final-certification/PHASE-0-SIGNOFF.md)

---

## 1. Purpose

This runbook defines the **official procedure for promoting staging-certified RC `c31f154`** (or a successor RC that has completed equivalent staging certification) to the production environment.

Phase 0 completed **staging certification only**. Production has **not** been deployed or validated. Executing this runbook constitutes the first production deployment and requires explicit leadership approval.

---

## 2. Scope

| In Scope | Out of Scope |
|----------|--------------|
| Production Cloud Run backend deploy | Mobile app release |
| Production database migration apply | Admin panel deploy |
| Production secrets provisioning | Frontend deploy |
| Production observability provisioning | Phase 6 scheduled job runner |
| Phased event platform enablement | OpenTelemetry implementation |
| Post-deploy validation window | Staging re-certification |

---

## 3. Prerequisites

### 3.1 Certification prerequisites

- [ ] Staging certification PASS for target RC (Phase 0: `c31f154` — **COMPLETE**)
- [ ] [PHASE-0-SIGNOFF.md](../final-certification/PHASE-0-SIGNOFF.md) signed by CTO and Release Engineering
- [ ] [PHASE-0-RISK-REGISTER.md](../final-certification/PHASE-0-RISK-REGISTER.md) limitations accepted in writing
- [ ] [RELEASE-NOTES-RC-c31f154.md](../release/RELEASE-NOTES-RC-c31f154.md) reviewed by on-call team

### 3.2 Infrastructure prerequisites

Verify before scheduling promotion window:

| Resource | Requirement | Verified By |
|----------|-------------|-------------|
| GCP production project | Provisioned; IAM roles assigned | Platform |
| Cloud Run service | `homigo-backend-production` (or org naming standard) | Platform |
| Cloud SQL PostgreSQL 16 | Backups ON, PITR ON, deletion protection ON | DBA |
| Redis | Production instance or Memorystore | Platform |
| Secret Manager | All production secrets created (see §3.3) | Security |
| Observability | Production Prometheus/Grafana or GMP equivalent | SRE |
| Alert routing | Slack/PagerDuty webhook configured | SRE |
| DNS / Load balancer | Production URL routed to Cloud Run | Platform |

### 3.3 Production secrets checklist

| Secret | Staging Reference | Production Action |
|--------|-------------------|-------------------|
| DATABASE_URL | `STAGING_DATABASE_URL` | Create `PRODUCTION_DATABASE_URL` |
| REDIS_URL | `STAGING_REDIS_URL` | Create `PRODUCTION_REDIS_URL` |
| OPS auth token | `STAGING_OPS_AUTH_TOKEN` | Create `PRODUCTION_OPS_AUTH_TOKEN` |
| Razorpay key ID | `rzp_test_*` | **LIVE** `rzp_live_*` — compliance approval required |
| Razorpay key secret | TEST secret | LIVE secret |
| Razorpay webhook secret | TEST webhook secret | LIVE webhook secret |
| Grafana admin password | Staging secret | Production secret |
| Slack webhook | Not configured on staging | **Required** for production |

**Never copy staging secrets to production.**

### 3.4 Personnel prerequisites

| Role | Responsibility | Available |
|------|----------------|-----------|
| Release Engineer | Executes deploy steps | Required |
| DBA / DBRE | Migration approval and monitoring | Required |
| SRE / On-call | Metrics and alert monitoring | Required |
| Backend Lead | Smoke test approval | Required |
| CTO or delegate | Go/no-go decision | Required |

---

## 4. Production Freeze

### 4.1 Freeze window

Schedule a **4-hour maintenance window** minimum:

| Phase | Duration |
|-------|----------|
| Pre-deploy verification | 30 min |
| Migration + deploy | 45 min |
| Smoke tests | 30 min |
| Monitoring window (initial) | 2 hours |
| Buffer | 15 min |

### 4.2 Freeze rules (T−24h to T+4h)

1. **No non-emergency production changes** to database, Cloud Run, or secrets.
2. **No staging deploys** of un-certified SHAs during active promotion.
3. **Change advisory** posted to engineering and operations channels.
4. **On-call rotation** confirmed; escalation contacts documented (§15).

---

## 5. Backup Verification

Execute **before** any production migration:

```powershell
# Replace with production project and instance names
$PROJECT = "<PRODUCTION_PROJECT>"
$INSTANCE = "<PRODUCTION_SQL_INSTANCE>"

gcloud sql backups list --instance=$INSTANCE --project=$PROJECT
gcloud sql instances describe $INSTANCE --project=$PROJECT `
  --format="yaml(settings.backupConfiguration,settings.deletionProtectionEnabled)"
```

**Pass criteria (match staging certified baseline):**

| Check | Expected |
|-------|----------|
| Automated backups | Enabled |
| Retained backups | ≥ 7 |
| PITR / transaction log retention | Enabled, ≥ 7 days |
| Deletion protection | Enabled |
| Latest backup age | < 24 hours |

**Evidence reference (staging):** `docs/evidence/stage-c-step-4/staging-restore-certification.md` — restore tested in 488–589 seconds.

**Run backup readiness script (adapt for production instance):**

```powershell
./deploy/scripts/database-backup-readiness.ps1 -Project $PROJECT -Instance $INSTANCE
```

---

## 6. PITR Verification

Confirm PITR window covers promotion window:

```powershell
gcloud sql instances describe $INSTANCE --project=$PROJECT `
  --format="value(settings.backupConfiguration.pointInTimeRecoveryEnabled)"
```

**Optional pre-flight:** Clone to isolated instance at current timestamp (non-destructive):

```powershell
$TS = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$TARGET = "${INSTANCE}-pre-promote-$(Get-Date -Format 'yyyyMMdd')"

gcloud sql instances clone $INSTANCE $TARGET `
  --project=$PROJECT `
  --point-in-time=$TS
```

Validate clone reaches RUNNABLE; delete clone after verification. **Do not attach clone to production traffic.**

**Runbook reference:** `docs/runbooks/database-restore.md`

---

## 7. Deployment Sequence

### 7.1 Pre-deploy identity lock

Record baseline before any change:

```powershell
$RC = "c31f154a128022fa7d9c4e44652506eedf3fa3e4"
$EXPECTED_DIGEST = "sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32"

# Record current production revision (if any) for rollback
gcloud run revisions list --service=homigo-backend-production `
  --region=asia-south1 --project=$PROJECT --limit=5
```

### 7.2 Database migration

**Apply migrations before traffic shift** (certified pattern from Stage C/D):

```bash
# Cloud Run Job or CI job with production DATABASE_URL
prisma migrate deploy
prisma migrate status  # expect: 31/31 up to date (or successor count)
```

**Pass criteria:** 0 failed migrations; status clean.

**Staging evidence:** Wave-1 clean replay 31/31 — `docs/evidence/stage-d/step-d-wave1-clean-replay-certification.md`

### 7.3 Container build and deploy

Use digest-pinned deploy per ADR-010:

```powershell
# Adapt script for production service name and project
./deploy/scripts/staging-gcp-deploy.ps1 -CommitSha $RC
# Production equivalent script must be used when available
```

**Initial production deploy — event flags phased:**

| Phase | EVENTS_OUTBOX_ENABLED | EVENTS_CONSUMERS_ENABLED |
|-------|----------------------|--------------------------|
| Deploy 1 | `true` | `false` |
| Deploy 2 (after metrics OK) | `true` | `true` |

Additional domain flags (mirror Stage D):

```
EVENTS_BOOKING_ENABLED=true
EVENTS_PAYMENT_ENABLED=true
EVENTS_TRACKING_ENABLED=true
EVENTS_PARTNER_ENABLED=true
```

**Do not set `STAGING_EVENTS_CERTIFICATION=1` in production.**

### 7.4 Traffic shift

Route 100% traffic to new revision after smoke tests on canary revision (if using traffic split) or direct 100% per ADR-010 staging pattern.

### 7.5 Identity verification post-deploy

Verify deployed artifact matches certified RC:

```powershell
gcloud run revisions describe <NEW_REVISION> `
  --region=asia-south1 --project=$PROJECT `
  --format="yaml(status.imageDigest,metadata.name)"
```

**Pass criteria:** Digest matches build from RC `$RC`.

**Staging evidence:** `docs/evidence/stage-g-soak/stage-g-release-identity.json`

---

## 8. Health Checks

Execute immediately after deploy:

```powershell
$URL = "<PRODUCTION_SERVICE_URL>"
$TOKEN = gcloud secrets versions access latest --secret=PRODUCTION_OPS_AUTH_TOKEN --project=$PROJECT

# Public health
curl -s "$URL/health" | jq .

# Authenticated readiness
curl -s -H "Authorization: Bearer $TOKEN" "$URL/ready"

# Metrics exposition
curl -s -H "Authorization: Bearer $TOKEN" "$URL/metrics" | Select-String "homigo_outbox_pending"
```

| Endpoint | Expected |
|----------|----------|
| `/health` | HTTP 200, database=ok, redis=ok |
| `/ready` | HTTP 200 with OPS token |
| `/metrics` | HTTP 200; valid Prometheus format |

**Staging reference:** All Stage D/E/G certifications — health PASS.

---

## 9. Smoke Tests

### 9.1 API smoke

| Test | Command / Action | Pass |
|------|------------------|------|
| Health loop (5×) | curl `/health` every 30s | 5/5 HTTP 200 |
| Auth rejection | `/ready` without token → 401 | Expected |
| Metrics scrape | Prometheus `up{job="homigo-backend-production"}=1` | Required |

### 9.2 Integration smoke (production-safe)

Execute **read-only or minimal-write** tests approved by Backend Lead. Do not run staging certification harness (`STAGING_EVENTS_CERTIFICATION=1`) in production.

Recommended minimum:

1. Authenticated admin health endpoint
2. Service catalog read (no booking creation unless approved)
3. Metrics counter baseline recorded

**Full lifecycle smoke** (booking → partner → payment) requires:
- Approved test customer and provider fixtures
- Razorpay LIVE test transaction with minimal amount — **finance approval required**
- Post-test cleanup plan

**Staging evidence for expected behavior:** Steps 10–12 certification reports.

---

## 10. Booking Verification

If booking smoke approved:

| Step | Verification |
|------|--------------|
| Create booking | HTTP 201; booking record in DB |
| `homigo.booking.created` | Row in `event_outbox` → PUBLISHED |
| Consumer receipts | Rows in `event_consumer_receipts` |
| Outbox pending | Returns to 0 within drain SLA (< 60s typical on staging) |

**Metrics:**

```
homigo_outbox_pending == 0
homigo_domain_event_total{event_type="homigo.booking.created"} increased
```

**Staging evidence:** `docs/evidence/stage-d-step-10/step-10-booking-certification.md`

---

## 11. Partner Verification

If partner smoke approved:

| Step | Verification |
|------|--------------|
| Dispatch | Assignment attempt created |
| Tracking update | GPS sequence accepted |
| en_route / arrived | Timestamps set on booking |
| Partner events | Outbox events PUBLISHED |

**Staging evidence:** `docs/evidence/stage-d-step-11/step-11-partner-certification.md`

---

## 12. Payment Verification

**Production payment verification requires LIVE Razorpay credentials and finance approval.**

| Step | Verification |
|------|--------------|
| Mode | Key prefix `rzp_live_*` confirmed — never TEST in production |
| Order create | Razorpay order ID returned |
| Verify | Signature validation PASS |
| Webhook | HMAC valid; dedup on replay |
| Settlement | Payment COMPLETED; ledger consistent |
| Event | `homigo.payment.success` PUBLISHED |
| Duplicate | Second verify returns idempotent result |

**Staging evidence (TEST mode):** `docs/evidence/stage-d-step-12/step-12-payment-certification.md`

**Production LIVE certification is NOT part of Phase 0 evidence.**

---

## 13. Metrics Verification

Monitor for **minimum 2 hours** post-deploy:

| Metric | Threshold | Alert |
|--------|-----------|-------|
| `homigo_outbox_pending` | ≤ 10 sustained | EventOutboxBacklogHigh |
| `homigo_outbox_oldest_pending_age_seconds` | < 300 | EventOutboxOldestPendingStale |
| `homigo_dlq_unresolved` | 0 unexpected growth | EventDlqGrowing |
| `homigo_consumer_failed_rate` | 0 sustained | EventConsumerFailureRateHigh |
| `homigo_scheduled_job_lag_seconds` | May be elevated | ScheduledJobLagHigh (known debt) |

**Grafana dashboard:** `homigo-operations` (production folder)

**Staging soak reference:** 62.3 min stable — `docs/evidence/stage-g-soak/stage-g-soak-summary.json`

---

## 14. Alert Verification

| Check | Action | Pass |
|-------|--------|------|
| Prometheus rules loaded | `promtool check rules` on deployed ruleset | SUCCESS |
| Alertmanager config | Validate receivers include production Slack/PagerDuty | Configured |
| Test notification | Send test alert to `#homigo-prod-alerts` | Received |
| Expected debt | ScheduledJobLagHigh may fire — document as known | Acknowledged |

**Staging gap:** Slack NOT_CONFIGURED — **must be resolved before production go-live.**

**Evidence:** `docs/evidence/stage-f-remediation/step-18-slack-delivery.json`

---

## 15. Rollback Conditions

Initiate rollback if **any** of the following occur during promotion window:

| Condition | Severity |
|-----------|----------|
| Migration failure or partial apply | CRITICAL — stop deploy |
| `/health` not 200 for > 5 minutes post-deploy | CRITICAL |
| `homigo_outbox_pending` sustained > 100 | HIGH |
| Unexplained DLQ growth (> 5 entries in 15 min) | HIGH |
| Payment settlement inconsistency | CRITICAL |
| Error rate > 5% on core API paths | HIGH |
| Data corruption suspected | CRITICAL — invoke PITR procedure |

**Procedure:** [ROLLBACK-RUNBOOK.md](./ROLLBACK-RUNBOOK.md)

---

## 16. Rollback Procedure

See [ROLLBACK-RUNBOOK.md](./ROLLBACK-RUNBOOK.md) for full decision tree.

**Summary:**

1. Shift Cloud Run traffic to prior digest-pinned revision.
2. If migration caused issue: forward-fix preferred; PITR clone for catastrophic failure.
3. Disable event consumers if uncontrolled DLQ growth: `EVENTS_CONSUMERS_ENABLED=false`.
4. Drain outbox before extended consumer disable.
5. Notify stakeholders; begin postmortem.

**Staging-certified rollback reference:**

```powershell
# Staging documented rollback to events-OFF baseline
D:\homigo\deploy\scripts\staging-gcp-deploy.ps1 -CommitSha e459175c72b1ece6e6246e5d69f559f23cd0a23e
```

Adapt for production prior revision SHA recorded in §7.1.

---

## 17. Rollback Commands

```powershell
# List revisions
gcloud run revisions list --service=homigo-backend-production `
  --region=asia-south1 --project=$PROJECT

# Route 100% traffic to prior revision
gcloud run services update-traffic homigo-backend-production `
  --to-revisions=<PRIOR_REVISION>=100 `
  --region=asia-south1 --project=$PROJECT

# Emergency: disable consumers via env update (after outbox drain)
gcloud run services update homigo-backend-production `
  --update-env-vars="EVENTS_CONSUMERS_ENABLED=false" `
  --region=asia-south1 --project=$PROJECT
```

---

## 18. Incident Escalation

| Level | Contact | Trigger |
|-------|---------|---------|
| L1 | On-call SRE | Alert fires or smoke test failure |
| L2 | Backend Lead + DBA | Migration issue, outbox/DLQ anomaly |
| L3 | CTO + Release Engineering | Rollback decision, data integrity |
| L4 | CEO / Legal | Payment breach, data exposure |

**Communication:** Incident channel + status page update if customer-facing impact.

---

## 19. Go / No-Go Checklist

Complete **60 minutes before** deploy start:

| # | Item | Go | No-Go |
|---|------|-----|-------|
| 1 | Staging certified for target RC | ☐ | ☐ |
| 2 | Sign-off obtained | ☐ | ☐ |
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

**Decision:** CTO or Release Engineering declares **GO** or **NO-GO**. NO-GO reschedules promotion.

---

## 20. Success Criteria

Promotion succeeds when **all** criteria met:

| # | Criterion |
|---|-----------|
| 1 | Deployed digest matches certified RC build |
| 2 | Migrations 31/31 (or successor) — status clean |
| 3 | `/health` 200 for 2-hour monitoring window |
| 4 | `homigo_outbox_pending` = 0 at end of window (no backlog) |
| 5 | `homigo_dlq_unresolved` = 0 unexplained entries |
| 6 | No CRITICAL rollback conditions triggered |
| 7 | Smoke tests PASS (approved scope) |
| 8 | Alert routing confirmed operational |
| 9 | Post-deploy report filed within 24 hours |

---

## 21. Failure Criteria

Promotion fails if **any** occur:

| # | Criterion | Action |
|---|-----------|--------|
| 1 | Migration apply failure | Rollback; PITR assessment |
| 2 | Health check failure > 5 min | Rollback revision |
| 3 | Lost events detected (reconciliation) | Halt consumers; incident |
| 4 | Duplicate payment effects | Halt payments; incident |
| 5 | Uncontrolled DLQ growth | Consumer disable; investigate |
| 6 | Go/no-go checklist incomplete | NO-GO — do not deploy |

---

## 22. Post Deployment Validation

Within **24 hours** of promotion:

1. File production deploy report with revision, digest, migration job ID, smoke results.
2. Capture Prometheus snapshots at T+0, T+1h, T+24h.
3. Reconcile outbox: pending = 0, lost = 0.
4. Schedule **7-day review** for error rates and alert noise.
5. Begin production certification evidence folder: `docs/evidence/production-promote-<date>/`

---

## 23. Monitoring Window

| Window | Activity |
|--------|----------|
| 0–2 hours | Active on-call; 5-min metric poll |
| 2–24 hours | Standard on-call; alert response |
| 24–72 hours | Elevated DLQ/outbox monitoring |
| 7 days | Weekly review of ScheduledJobLagHigh and consumer rates |

---

## 24. Signoff Requirements

| Role | Signoff | Date |
|------|---------|------|
| Release Engineer | Deploy executed per runbook | __________ |
| DBA | Migration verified | __________ |
| SRE | Observability + alerts operational | __________ |
| Backend Lead | Smoke tests approved | __________ |
| CTO | Production promotion authorized | __________ |

Store signed checklist with production deploy report.

---

## 25. Lessons Learned

Derived from Phase 0 staging certification — apply to production promotion:

| Lesson | Source | Action |
|--------|--------|--------|
| Certification harness must use unique fixture names | Stage G Run 1 FAIL | Production smoke tests use unique correlation IDs |
| Payment orchestrator env vars must match deploy path | Stage G Run 1 | Verify production job definitions before deploy |
| Digest-pinned identity verification mandatory | Step 8, Stage G | Block promotion on digest mismatch |
| Incremental event enablement reduces blast radius | Stage D runbook | Deploy consumers after outbox verified |
| Slack routing must exist before go-live | Stage F limitation | Gate 3.3 checklist item |
| Harness failures ≠ application failures | Stage G classification | Separate tooling defects from prod incidents |
| Preserve evidence for audit | Phase 0 program | Production evidence folder required |

---

## Appendix A — Staging Certified Reference Values

For comparison during production validation (staging only — not production targets):

| Metric | Staging Value @ Stage G |
|--------|-------------------------|
| SOAK_DURATION_MINUTES | 62.3 |
| MEMORY_GROWTH_PCT | 2.5 |
| LOST_EVENTS | 0 |
| BOOKINGS_SUCCEEDED | 9/9 |
| MIGRATIONS | 31/31 |

**Source:** `docs/evidence/stage-g-soak/stage-g-soak-summary.json`

---

## Appendix B — Related Documents

| Document | Path |
|----------|------|
| ADR-012 | `docs/architecture/adr-012-production-promotion-strategy.md` |
| Database restore | `docs/runbooks/database-restore.md` |
| Stage D runbook (staging reference) | `docs/evidence/stage-d/stage-d-runbook.md` |
| Final certification | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |

---

**Document status:** Active — awaiting first production execution  
**Next review:** After first production promotion or 2027-02-06
