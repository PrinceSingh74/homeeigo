# Rollback Runbook

**Document ID:** `OPS-RUNBOOK-ROLLBACK-001`  
**Version:** 1.0  
**Effective Date:** 2026-08-06  
**Owner:** Release Engineering / SRE  
**Certified Baseline RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`

**Cross-references:**
[Production Promotion Runbook](./PRODUCTION-PROMOTION-RUNBOOK.md) ·
[ADR-010 Deployment Strategy](../architecture/adr-010-deployment-strategy.md) ·
[ADR-012 Production Promotion](../architecture/adr-012-production-promotion-strategy.md) ·
[Database Restore Runbook](../runbooks/database-restore.md) ·
[Risk Register](../final-certification/PHASE-0-RISK-REGISTER.md)

---

## 1. Purpose

Define **when and how to roll back** HOMIGO backend deployments across staging and production environments. This runbook covers application revision rollback, event platform safety, database recovery boundaries, and post-rollback verification.

Rollback decisions prioritize **customer data integrity** and **payment safety** over deployment velocity.

---

## 2. Scope

| Environment | Rollback Supported |
|-------------|-------------------|
| Staging (`homigo-497619`) | YES — certified procedures |
| Production | YES — procedure defined; not yet executed in Phase 0 |

---

## 3. Rollback Trigger Matrix

| Trigger | Severity | Rollback Type | Max Decision Time |
|---------|----------|---------------|-------------------|
| `/health` not 200 for > 5 min post-deploy | CRITICAL | Application revision | 10 min |
| Migration apply failure | CRITICAL | Stop deploy; DB forward-fix or PITR | Immediate |
| Duplicate payment settlement detected | CRITICAL | Disable payments + app rollback | Immediate |
| `homigo_outbox_pending` sustained > 100 | HIGH | Consumer disable → investigate → app rollback | 30 min |
| Unexplained DLQ growth (> 5 in 15 min) | HIGH | Consumer disable → investigate | 30 min |
| Lost events (reconciliation > 0) | CRITICAL | Halt consumers; app rollback; incident | Immediate |
| Error rate > 5% core API | HIGH | Application revision | 20 min |
| Memory runaway / OOM restart loop | HIGH | Application revision | 15 min |
| Bad deploy wrong digest / wrong SHA | CRITICAL | Application revision | Immediate |
| Alert storm (non-debt) | MEDIUM | Investigate; rollback if no root cause in 30 min | 30 min |
| ScheduledJobLagHigh only | LOW | **Do not rollback** — known Phase 6 debt | N/A |

**Staging evidence for stable baseline:** Stage G — 0 lost events, 0 unexplained DLQ — `docs/evidence/stage-g-soak/stage-g-soak-summary.json`

---

## 4. Rollback Decision Tree

```
Incident detected post-deploy
        │
        ▼
  Is customer data or payment integrity at risk?
        │
   YES ─┴─ NO
   │        │
   ▼        ▼
 CRITICAL  Is /health failing or error rate > 5%?
 path       │
 IMMEDIATE  YES ──┴── NO
 rollback   │        │
 + disable  ▼        ▼
 payments  App      Is outbox/DLQ anomalous?
           revision  │
           rollback  YES ──┴── NO
                     │        │
                     ▼        ▼
              Disable       Monitor
              consumers     30 min
                     │        │
                     ▼        Still bad?
              Drain outbox ── YES ──► App revision rollback
                     │
                     ▼
              Investigate root cause
                     │
                     ▼
              Forward-fix or rollback
```

**Escalation:** CRITICAL paths require L3 (CTO + Release Engineering) approval except immediate payment halt (any L2+ may execute).

---

## 5. Database Rollback Rules

### 5.1 Principles

1. **Forward-fix preferred** over schema rollback for migration issues.
2. **Never in-place restore** over active production or staging serving instance without write-stop and leadership approval.
3. **PITR clone** creates isolated recovery target — not automatic cutover.
4. **Migration rollback scripts** are not certified in Phase 0 — do not assume `prisma migrate rollback` exists for Wave-1.

### 5.2 When to use PITR

| Scenario | Action |
|----------|--------|
| Catastrophic migration corruption | PITR clone to pre-migration timestamp; validate; planned cutover |
| Accidental data deletion | PITR clone; extract rows; merge forward |
| Application bug caused bad writes | Forward-fix or selective restore — not full PITR unless severe |
| Outbox row corruption | Operator replay/DLQ tools first; PITR last resort |

### 5.3 PITR procedure (summary)

Full detail: `docs/runbooks/database-restore.md`

```powershell
$SOURCE = "<SQL_INSTANCE>"
$TARGET = "${SOURCE}-pitr-recovery-$(Get-Date -Format 'yyyyMMddHHmm')"
$PITR_TS = "<UTC_TIMESTAMP_BEFORE_INCIDENT>"

gcloud sql instances clone $SOURCE $TARGET `
  --project=<PROJECT> `
  --point-in-time=$PITR_TS
```

**Staging certified timing:** Clone 488–589 seconds (~8–10 min).  
**Evidence:** `docs/evidence/stage-c-step-4/staging-restore-certification.md`

### 5.4 Database rollback — DO NOT

- Do not drop production database to restore backup in place.
- Do not run migrations against PITR clone then point production URL without full validation.
- Do not disable deletion protection to expedite recovery without approval.

---

## 6. Application Rollback Rules

### 6.1 Preferred method: Cloud Run revision traffic shift

Rollback = route 100% traffic to **prior known-good revision** with verified digest.

**Requirements for rollback target:**
- Prior revision digest recorded in deploy pre-flight (Promotion Runbook §7.1)
- Prior revision passed health checks when serving
- Migration compatibility verified (prior RC must tolerate current schema OR schema rolled forward)

### 6.2 Staging certified rollback example

Documented in Stage D certification status — rollback to events-OFF Phase 0 baseline:

| Field | Value |
|-------|-------|
| Rollback SHA | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` |
| Effect | Events OFF on certified Phase-0 RC image |
| Migrations | 23/23 (pre-Wave-1) |

```powershell
D:\homigo\deploy\scripts\staging-gcp-deploy.ps1 `
  -CommitSha e459175c72b1ece6e6246e5d69f559f23cd0a23e
```

**Warning:** Rolling back application below Wave-1 while database has 31 migrations may cause P2022 schema errors on deferred columns. **Coordinate with DBA.**

### 6.3 Application rollback — DO NOT

- Do not rollback to digest that never served traffic in target environment.
- Do not rollback without recording incident timeline.
- Do not leave consumers enabled against incompatible schema.

---

## 7. Container Rollback

Container rollback is achieved via **Cloud Run revision traffic shift**, not image deletion.

```powershell
# Verify rollback target digest
gcloud run revisions describe <PRIOR_REVISION> `
  --region=asia-south1 --project=<PROJECT> `
  --format="value(status.imageDigest)"

# Shift traffic
gcloud run services update-traffic homigo-backend-staging `
  --to-revisions=<PRIOR_REVISION>=100 `
  --region=asia-south1 --project=<PROJECT>
```

**Certified serving revision (current staging):** `homigo-backend-staging-00029-pbn`  
**Certified digest:** `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32`

---

## 8. Cloud Run Revision Rollback

### 8.1 List revisions

```powershell
gcloud run revisions list `
  --service=homigo-backend-staging `
  --region=asia-south1 `
  --project=homigo-497619 `
  --sort-by="~metadata.creationTimestamp"
```

### 8.2 Rollback command

```powershell
gcloud run services update-traffic homigo-backend-staging `
  --to-revisions=homigo-backend-staging-00029-pbn=100 `
  --region=asia-south1 `
  --project=homigo-497619
```

Replace revision name with prior known-good revision.

### 8.3 Verify rollback

```powershell
gcloud run services describe homigo-backend-staging `
  --region=asia-south1 --project=homigo-497619 `
  --format="yaml(status.traffic,status.latestReadyRevisionName)"
```

Confirm 100% traffic on intended revision.

---

## 9. Redis Considerations

| Scenario | Action |
|----------|--------|
| Leader lock stale after rollback | Self-heals on next tick (120s lease timeout certified) |
| Redis unavailable | Outbox processor may stall; monitor `homigo_outbox_pending` |
| Bad data in Redis cache | Flush staging cache keys per runbook — **never flush production without approval** |
| Rollback does not require Redis restore | Redis is coordination/cache — rebuilds from PostgreSQL truth |

**Staging evidence:** Redis stable throughout Stage G — `redis_up=1`, 0 errors.

---

## 10. Event Outbox Considerations

### 10.1 Before disabling consumers

1. Check `homigo_outbox_pending` — if > 0, allow drain window (typically seconds to minutes on staging).
2. Monitor `homigo_outbox_oldest_pending_age_seconds`.
3. Do not disable outbox processor with large pending backlog without investigation.

### 10.2 Kill switch sequence (certified staging pattern)

From `docs/evidence/stage-d/stage-d-runbook.md`:

```
Step 1: EVENTS_CONSUMERS_ENABLED=false  (stop side effects)
Step 2: Allow outbox drain to pending=0
Step 3: EVENTS_OUTBOX_ENABLED=false     (if full event halt required)
```

### 10.3 After application rollback

| Check | Expected |
|-------|----------|
| Outbox processor running | Per rollback RC flags |
| Pending count | Trending to 0 |
| PROCESSING stale rows | Recovered within 120s lease |

**Processing model:** LEADER_SINGLE_ACTIVE_WITH_SKIP_LOCKED (ADR-003)

---

## 11. DLQ Considerations

| Scenario | Action |
|----------|--------|
| DLQ growth during bad deploy | Disable consumers; stop new DLQ entries |
| Rollback with existing DLQ rows | DLQ persists in PostgreSQL — not auto-cleared |
| Post-rollback DLQ | Triage entries; replay only after root cause fixed |
| Synthetic cert DLQ rows | Must not exist in production; staging cleaned post-Step 18 |

**Operator replay:** `replayDeadLetterById` — certified Step 16. Replay only when root cause resolved and idempotency confirmed.

**Do not mass-delete DLQ rows without audit trail.**

---

## 12. Payment Safety

Payment rollback has **highest severity** constraints.

### 12.1 Immediate actions on payment incident

1. **Disable payment endpoints** at load balancer or feature flag if available.
2. Set `EVENTS_PAYMENT_ENABLED=false` if payment events propagating bad state.
3. Do **not** retry webhooks blindly — verify idempotency first.
4. Notify finance and legal for LIVE payment environments.

### 12.2 Rollback compatibility

| Concern | Guidance |
|---------|----------|
| Duplicate settlement | Idempotency keys + webhook dedup certified on staging TEST — verify LIVE |
| In-flight Razorpay orders | Reconcile with Razorpay dashboard before rollback |
| Ledger consistency | Do not rollback app without DBA ledger reconciliation |
| Webhook replay | Razorpay may replay webhooks after rollback — ensure dedup active |

**Staging evidence:** Step 12 — 0 duplicate payment effects; webhook idempotency PASS.

### 12.3 Payment rollback — DO NOT

- Do not switch Razorpay LIVE → TEST in production as "rollback."
- Do not delete payment records to "fix" duplication — incident procedure required.
- Do not rollback database without finance sign-off if payments processed during incident window.

---

## 13. Verification After Rollback

Execute within **30 minutes** of rollback completion:

### 13.1 Application health

```powershell
$URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app"
curl -s "$URL/health"
```

| Check | Pass |
|-------|------|
| HTTP 200 | Required |
| database=ok | Required |
| redis=ok | Required |

### 13.2 Identity verification

Confirm serving revision matches rollback target:

```powershell
gcloud run services describe homigo-backend-staging `
  --region=asia-south1 --project=homigo-497619 `
  --format="value(status.latestReadyRevisionName,status.traffic)"
```

Compare digest to expected rollback SHA build.

### 13.3 Event platform metrics

```powershell
$TOKEN = gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=homigo-497619
curl -s -H "Authorization: Bearer $TOKEN" "$URL/metrics" | Select-String "homigo_(outbox|dlq)"
```

| Metric | Pass Criteria |
|--------|---------------|
| `homigo_outbox_pending` | Trending to 0 |
| `homigo_dlq_unresolved` | No unexplained growth post-rollback |
| `homigo_consumer_failed_rate` | 0 sustained |

### 13.4 Business smoke (minimal)

- Read-only API paths functional
- No elevated 5xx in Cloud Logging for 15 min
- If payments were affected: reconciliation report initiated

### 13.5 Rollback success declaration

Rollback succeeds when health PASS, traffic on intended revision, outbox stable, and incident commander declares stable.

---

## 14. Postmortem Checklist

Complete within **5 business days** of rollback:

| # | Item | Owner |
|---|------|-------|
| 1 | Incident timeline (UTC) with deploy and rollback timestamps | SRE |
| 2 | Root cause category: app / migration / config / harness / external | Backend |
| 3 | Rollback type used: revision / consumer disable / PITR | Release Eng |
| 4 | Customer impact assessment | Product |
| 5 | Payment impact assessment (if applicable) | Finance |
| 6 | Lost events reconciliation result | Backend |
| 7 | DLQ entries created during incident — disposition | Backend |
| 8 | Action items with owners and due dates | Engineering |
| 9 | Update runbook if procedure gap found | SRE |
| 10 | Evidence preserved in `docs/evidence/incidents/<date>/` | Release Eng |

### Blameless postmortem questions

1. Did rollback execute within trigger matrix decision times?
2. Was rollback target revision pre-recorded?
3. Did event kill switch sequence prevent duplicate effects?
4. Was ScheduledJobLagHigh mistaken for incident cause?
5. What certification gap would have caught this pre-production?

---

## Appendix A — Environment Quick Reference

### Staging (certified)

| Field | Value |
|-------|-------|
| Project | `homigo-497619` |
| Service | `homigo-backend-staging` |
| Region | `asia-south1` |
| Certified revision | `homigo-backend-staging-00029-pbn` |
| Certified SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| Database instance | `homigo-staging-step6a-pitr-20260803` |
| Rollback SHA (events OFF) | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` |

### Production

Production rollback targets must be recorded at deploy time. Phase 0 provides **no production rollback execution evidence**.

---

## Appendix B — Event Flag Reference

| Flag | Rollback safe order |
|------|---------------------|
| `EVENTS_CONSUMERS_ENABLED` | Disable first |
| `EVENTS_OUTBOX_ENABLED` | Disable after drain |
| `EVENTS_BOOKING_ENABLED` | Domain-specific disable |
| `EVENTS_PAYMENT_ENABLED` | Disable on payment incident |
| `EVENTS_TRACKING_ENABLED` | Domain-specific disable |
| `EVENTS_PARTNER_ENABLED` | Domain-specific disable |
| `STAGING_EVENTS_CERTIFICATION` | Staging only — never set in production |

---

## Appendix C — Evidence References

| Topic | Evidence |
|-------|----------|
| Rollback SHA documented | `docs/evidence/stage-d/stage-d-certification-status.md` |
| Kill switches | `docs/evidence/stage-d/stage-d-runbook.md` |
| DLQ replay | `docs/evidence/stage-e-step-16/step-16-retry-dlq-replay-certification.md` |
| Outbox drain | `docs/evidence/stage-e-step-14/step-14-outbox-drain-certification.md` |
| PITR restore | `docs/evidence/stage-c-step-4/staging-restore-certification.md` |
| Release identity | `docs/evidence/stage-g-soak/stage-g-release-identity.json` |
| ADR deployment | `docs/architecture/adr-010-deployment-strategy.md` |

---

**Document status:** Active  
**Next review:** After first production rollback exercise or 2027-02-06
