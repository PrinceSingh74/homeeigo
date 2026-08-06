# Enterprise Operations Handbook

**Document ID:** `OPS-HANDBOOK-001`  
**Version:** 1.0  
**Effective Date:** 2026-08-06  
**Certified Baseline:** Staging @ RC `c31f154` · **Production NOT DEPLOYED**  
**Owner:** SRE / Release Engineering

**Navigation:** [Documentation Index](../DOCUMENTATION-INDEX.md) · [Rollback Runbook](./ROLLBACK-RUNBOOK.md) · [Promotion Runbook](./PRODUCTION-PROMOTION-RUNBOOK.md) · [System Blueprint](../architecture/HOMIGO-ENTERPRISE-SYSTEM-BLUEPRINT.md)

---

## 1. Purpose and Scope

This handbook defines standard operating procedures for HOMIGO backend operations. Procedures reflect **certified staging behavior** unless marked **PRODUCTION — NOT EXECUTED**.

| Environment | Project | Service | Status |
|-------------|---------|---------|--------|
| Staging | `homigo-497619` | `homigo-backend-staging` | **CERTIFIED** |
| Production | TBD | TBD | **NOT DEPLOYED** |

---

## 2. Daily Operations

### 2.1 Morning health check (15 min)

| Step | Action | Pass Criteria | Evidence Ref |
|------|--------|---------------|--------------|
| 1 | `curl /health` on staging URL | HTTP 200, db=ok, redis=ok | Stage G |
| 2 | Check `homigo_outbox_pending` | 0 or bounded (< 10) | `stage-g-snapshot-T_FINAL.json` |
| 3 | Check `homigo_dlq_unresolved` | 0 unexplained | Step 16 |
| 4 | Review Alertmanager | No unexpected firing (except ScheduledJobLagHigh) | `stage-g-alert-review.json` |
| 5 | Verify obs VM running | `homigo-obs-staging` RUNNING | `cloud-inventory.json` |

### 2.2 Daily log review (10 min)

- Cloud Logging: filter `severity>=ERROR` on `homigo-backend-staging`, last 24h.
- Classify: harness noise vs application ERROR.
- Escalate unexplained ERROR patterns per §19.

### 2.3 Daily metrics snapshot

Record in ops log: outbox pending, DLQ count, consumer failed rate, active Cloud Run instances.

---

## 3. Weekly Operations

| Task | Frequency | Procedure |
|------|-----------|-----------|
| Backup verification | Weekly | `gcloud sql backups list` — latest < 7 days old |
| Grafana dashboard review | Weekly | Open `homigo-operations`; verify panels query |
| DLQ triage | Weekly | Query unresolved DLQ; replay or document |
| Certificate/expiry check | Weekly | Secret Manager versions; VM patch status |
| Evidence hygiene | Weekly | No secrets in `docs/evidence/` commits |

**Backup reference:** `docs/runbooks/database-restore.md`

---

## 4. Monthly Operations

| Task | Owner | Procedure |
|------|-------|-----------|
| PITR drill (staging) | DBA | Isolated clone to non-serving instance; validate |
| Alert rule review | SRE | `promtool check rules`; review firing history |
| Capacity review | SRE | Cloud Run instance count, DB connections, Redis memory |
| Risk register review | Engineering Lead | Update [Risk Register](../final-certification/PHASE-0-RISK-REGISTER.md) |
| ADR review date check | Architecture | ADR-INDEX review dates |

**PITR certified timing:** 488–589 seconds — `stage-c-step-4/staging-restore-certification.md`

---

## 5. Release Operations

1. Confirm RC has staging certification evidence (or execute cert program).
2. Review [Release Notes](../release/RELEASE-NOTES-RC-c31f154.md).
3. Record current revision as rollback target.
4. Execute deploy per ADR-010.
5. Verify identity digest post-deploy.
6. Post-release validation per §32.

**Production release:** Follow [Production Promotion Runbook](./PRODUCTION-PROMOTION-RUNBOOK.md) — **NOT YET EXECUTED**.

---

## 6. Deployment Operations

```powershell
# Staging deploy (certified pattern)
./deploy/scripts/staging-gcp-deploy.ps1 -CommitSha <FULL_SHA>

# Stage D incremental (events)
./deploy/scripts/staging-gcp-deploy-stage-d.ps1 -CommitSha <SHA> -OutboxOnly
```

**Pre-deploy:** Clean worktree, migration status clean, backup verified.  
**Post-deploy:** Identity verification — `stage-g-release-identity.json` pattern.

---

## 7. Rollback Operations

See [ROLLBACK-RUNBOOK.md](./ROLLBACK-RUNBOOK.md).

**Quick sequence:** Disable consumers → drain outbox → revision traffic shift → verify health.

**Staging rollback SHA (events OFF):** `e459175c72b1ece6e6246e5d69f559f23cd0a23e`

---

## 8. Backup Verification

```powershell
gcloud sql backups list --instance=homigo-staging-step6a-pitr-20260803 --project=homigo-497619
./deploy/scripts/database-backup-readiness.ps1 -Project homigo-497619 -Instance homigo-staging-step6a-pitr-20260803
```

**Expected:** Backups ON, 7 retained, PITR enabled, deletion protection ON.

---

## 9. PITR Validation

Monthly isolated clone:

```powershell
gcloud sql instances clone homigo-staging-step6a-pitr-20260803 <TARGET> `
  --project=homigo-497619 --point-in-time=<UTC_TIMESTAMP>
```

**Never** attach clone to production traffic without approval.

---

## 10. Health Verification

| Endpoint | Auth | Expected |
|----------|------|----------|
| `/health` | None | 200, database=ok, redis=ok |
| `/ready` | OPS Bearer | 200 |
| `/metrics` | OPS Bearer | 200, Prometheus format |

**Staging URL:** `https://homigo-backend-staging-144968192234.asia-south1.run.app`

---

## 11. Cloud Run Monitoring

| Metric / Check | Source | Alert |
|----------------|--------|-------|
| Instance count | Cloud Run console | min=2 expected |
| Request latency | Cloud Logging / Grafana | Anomaly review |
| 5xx rate | Cloud Logging | > 1% sustained → incident |
| Revision identity | `gcloud run revisions describe` | Digest match |

**CPU in /metrics:** NOT AVAILABLE — INCONCLUSIVE (Stage G).

---

## 12. PostgreSQL Monitoring

| Metric | Source | Threshold |
|--------|--------|-----------|
| `db_connections_active` | `/metrics` | Peak 5 certified; investigate > 20 |
| `db_connections_idle` | `/metrics` | ~29 on staging |
| Deadlocks | Cloud SQL logs / app logs | 0 expected |
| P2021/P2022 | Application logs | 0 on cert paths |
| Migration status | `prisma migrate status` | 31/31 |

**Instance:** `homigo-staging-step6a-pitr-20260803`

---

## 13. Redis Monitoring

| Metric | Expected (staging) |
|--------|-------------------|
| `redis_up` | 1 |
| `redis_memory_bytes` | ~4.2 MB stable |
| `redis_evicted_keys` | 0 |
| `redis_connected_clients` | ~9 |

**Leader lock key:** `maintenance:event_outbox`

---

## 14. Outbox Monitoring

| Metric | Normal | Action |
|--------|--------|--------|
| `homigo_outbox_pending` | 0 | > 10 sustained → investigate |
| `homigo_outbox_oldest_pending_age_seconds` | 0 | > 300 → alert fires |
| PROCESSING stale rows | Recovered in 120s | Check leader lock |

**Alert:** `EventOutboxBacklogHigh`, `EventOutboxOldestPendingStale` — certified Step 18.

---

## 15. Consumer Monitoring

| Metric | Normal | Action |
|--------|--------|--------|
| `homigo_consumer_failed_rate` | 0 | > 0 sustained → incident |
| Consumer receipts | Match events × consumers | Reconciliation job |

**Certified consumers (`homigo.booking.created`):** metrics.v1, audit.v1, ai-context-indexer.v1

---

## 16. DLQ Monitoring

| Metric | Normal | Action |
|--------|--------|--------|
| `homigo_dlq_unresolved` | 0 | Any unexplained growth → triage |
| DLQ age | — | Operator replay after root cause fix |

**Replay:** `replayDeadLetterById` — Step 16 certified.  
**Alert:** `EventDlqGrowing` (15m `for:`).

---

## 17. Prometheus Monitoring

- **Host:** `homigo-obs-staging` (GCE)
- **Scrape target:** staging Cloud Run `/metrics`
- **Validation:** `promtool check rules apps/backend/monitoring/homigo-alerts.yml`

Weekly: verify `up{job="homigo-backend-staging"}=1`

---

## 18. Grafana Monitoring

- **URL:** GCE VM `:3000` (auth required)
- **Dashboard UID:** `homigo-operations`
- **Version:** v11.3.0 (certified)

Weekly: verify event throughput panels show data.

---

## 19. Alertmanager Monitoring

| Alert | Expected Staging State |
|-------|------------------------|
| EventOutboxBacklogHigh | inactive |
| EventOutboxOldestPendingStale | inactive |
| EventConsumerFailureRateHigh | inactive |
| EventDlqGrowing | inactive |
| ScheduledJobLagHigh | **firing** (known Phase 6 debt) |

**Slack delivery:** NOT_CONFIGURED — manual Alertmanager/Grafana check required.

---

## 20. Incident: Booking

| Symptom | Check | Action |
|---------|-------|--------|
| Booking create fails | `/health`, logs P2022 | Schema/migration issue → DBA |
| Events not publishing | `homigo_outbox_pending` | Outbox processor / leader lock |
| Missing consumer effects | `event_consumer_receipts` | Consumer failure → DLQ triage |

**Certified baseline:** Step 10 PASS — `stage-d-step-10/`

---

## 21. Incident: Partner

| Symptom | Check | Action |
|---------|-------|--------|
| Dispatch fails | Assignment engine logs | Partner availability / fixtures |
| GPS/tracking stale | `step-11-tracking.json` pattern | Throttle / tracking service |
| Missing timestamps | bookings en_route_at, arrived_at | tracking.service.ts |

**Certified baseline:** Step 11 PASS

---

## 22. Incident: Payment

| Symptom | Check | Action |
|---------|-------|--------|
| Razorpay order fail | Key prefix `rzp_test_*` on staging | Secret Manager |
| Webhook reject | HMAC logs | Webhook secret mismatch |
| Duplicate settlement | Idempotency keys | **HALT** — finance escalation |

**Staging:** TEST only. **Production LIVE:** NOT CERTIFIED.

---

## 23. Incident: Notification

| Symptom | Check | Action |
|---------|-------|--------|
| Push not delivered | Staging uses synthetic fixtures | Expected N/A external delivery |
| Notification regression | `step-10-notification-regression.json` | Compare consumer receipts |

---

## 24. Incident: API Failure

1. Check Cloud Run revision status and traffic split.
2. Check `/health` — database vs redis failure.
3. Review Cloud Logging 5xx.
4. Rollback if deploy-correlated — [Rollback Runbook](./ROLLBACK-RUNBOOK.md).

---

## 25. Incident: Authentication Failure

- `/ready` and `/metrics` return 401 without OPS token — **expected**.
- Verify `STAGING_OPS_AUTH_TOKEN` in Secret Manager.
- JWT failures on API routes — check auth middleware logs (Step 8).

---

## 26. Incident: Redis Failure

| Symptom | Impact | Action |
|---------|--------|--------|
| redis_up=0 | Health fail; leader lock fail | Restore Redis; outbox may stall |
| Connection errors | Processor skips ticks | Failover / restart |

**Staging evidence:** 0 Redis errors during Stage G soak.

---

## 27. Incident: Database Failure

1. Check Cloud SQL instance state (RUNNABLE).
2. Check connection counts in `/metrics`.
3. P2021/P2022 — classify Phase 0 path vs deferred schema.
4. Catastrophic: PITR procedure — `docs/runbooks/database-restore.md`.

---

## 28. Incident: Cloud Run Failure

- Check revision ready state.
- Check min instances (2) serving.
- Cold start latency — verify minScale.
- Rollback revision if bad deploy.

---

## 29. High CPU

**Limitation:** Cloud Run CPU not exported in `/metrics` (Stage G INCONCLUSIVE).

**Response:** Cloud Run console metrics; absence of saturation alerts; log review for hot paths.

---

## 30. High Memory

| Threshold (staging certified) | Action |
|-------------------------------|--------|
| Sustained growth > 10% over soak window | Investigate leak |
| Stage G baseline: +2.5% over 62 min | NORMAL |

Monitor `process_resident_memory_bytes` via `/metrics` snapshots.

---

## 31. Storage Growth

- **PostgreSQL:** Monitor disk via Cloud SQL console; outbox/receipts growth.
- **Prometheus TSDB:** VM disk on `homigo-obs-staging`.
- **Action:** Retention policies; receipt archival (future — not certified).

---

## 32. Outbox Growth

1. Check `homigo_outbox_pending` trend.
2. Check leader lock holder (Redis).
3. Check consumer failed rate.
4. Check DB contention (Step 14 DB pressure pattern).
5. Escalate if pending > 100 sustained.

---

## 33. DLQ Growth

1. Query `event_dead_letters` unresolved.
2. Identify consumer and event type.
3. Fix root cause before mass replay.
4. Use `replayDeadLetterById` per entry.

---

## 34. Consumer Failures

1. `homigo_consumer_failed_rate` > 0
2. Check logs for consumer name and event type.
3. DLQ entry created after inline retries exhausted (ADR-004).
4. Do not delete DLQ rows without audit trail.

---

## 35. Scheduled Job Failures

**Classification:** KNOWN ARCHITECTURAL DEBT — Phase 6 runner deferred.

- Alert: `ScheduledJobLagHigh` — **expected firing** on staging.
- **Do not rollback** for this alert alone.
- Reference: `scheduled-job-lag-root-cause.md`

---

## 36. Security Incident

1. Rotate compromised secrets in Secret Manager immediately.
2. Revoke OPS tokens; redeploy if needed.
3. SECRET_SCAN evidence bundles if leak suspected.
4. Escalate to CISO per §19 matrix.
5. **Never** commit secrets to repository.

---

## 37. Disaster Recovery

| Scenario | RTO Target | Procedure |
|----------|------------|-----------|
| Bad deploy | < 15 min | Revision rollback |
| DB corruption | Hours | PITR clone + validation |
| Region loss | Not certified | Single-region staging — multi-region future |

**DR runbook:** `docs/runbooks/database-restore.md`

---

## 38. Incident Severity Matrix

| Severity | Definition | Response Time | Examples |
|----------|------------|---------------|----------|
| **SEV-1** | Production down, data/payment integrity | Immediate | Duplicate payment, lost events |
| **SEV-2** | Major degradation, staging cert path broken | 30 min | Outbox backlog > 100, health fail |
| **SEV-3** | Partial impact, workaround exists | 4 hours | Single consumer failing |
| **SEV-4** | Minor, known debt | Next business day | ScheduledJobLagHigh only |

**Note:** Production SEV definitions **NOT VALIDATED** — production NOT DEPLOYED.

---

## 39. Escalation Matrix

| Level | Role | Contact |
|-------|------|---------|
| L1 | On-call SRE | Rotation schedule |
| L2 | Backend Lead + DBA | Engineering |
| L3 | CTO + Release Engineering | Leadership |
| L4 | CISO / Finance / Legal | Security/payment breaches |

---

## 40. On-Call Process

1. Monitor Grafana + Alertmanager (Slack deferred — manual).
2. Acknowledge within 15 min (SEV-2+).
3. Document incident timeline in ops log.
4. Preserve evidence if certification-related.
5. Postmortem within 5 days for SEV-1/2 — [Rollback §14](./ROLLBACK-RUNBOOK.md).

---

## 41. Capacity Planning

| Resource | Staging Certified | Planning Notes |
|----------|-------------------|----------------|
| Cloud Run | min=2, max=4 | Scale max for burst |
| PostgreSQL | connections peak 5 active | Monitor growth |
| Redis | ~4.2 MB | Leader lock only — low memory |
| Outbox throughput | 500 event burst drained | Batch 50, interval 5s |

---

## 42. Maintenance Windows

- **Staging:** Prefer low-traffic UTC windows; notify #engineering.
- **Obs VM:** Patch monthly; verify scrape after restart.
- **Database:** Maintenance via Cloud SQL scheduled window; verify PITR after.

---

## 43. Production Checklist

Execute [PHASE-0-PRODUCTION-READINESS-CHECKLIST.md](../final-certification/PHASE-0-PRODUCTION-READINESS-CHECKLIST.md) before first production deploy.

**Current status:** 78 staging CERTIFIED · Production gates **NOT MET**.

---

## 44. Post-Release Validation

Within 2 hours of any deploy:

| Check | Pass |
|-------|------|
| `/health` 200 × 5 | ☐ |
| Identity digest match | ☐ |
| `homigo_outbox_pending` = 0 | ☐ |
| `homigo_dlq_unresolved` = 0 | ☐ |
| No unexplained ERROR logs | ☐ |
| Grafana panels query | ☐ |

**Staging soak reference:** 62.3 min, 0 lost events — Stage G Run 2.

---

## Appendix — Certified Staging Baselines

| Metric | Value | Source |
|--------|-------|--------|
| SOAK_DURATION_MIN | 62.3 | `stage-g-soak-timing.json` |
| MEMORY_GROWTH_PCT | 2.5 | `stage-g-soak-summary.json` |
| LOST_EVENTS | 0 | `stage-g-final-reconciliation.json` |
| EVENT p50 | ~0.019s | Stage G snapshots |
| MIGRATIONS | 31/31 | `stage-g-migrations.json` |

---

**Handbook status:** Active · **Production procedures:** Documented, NOT EXECUTED · **Review:** 2027-02-06
