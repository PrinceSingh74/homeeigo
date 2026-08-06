# Release Notes — RC c31f154

**HOMIGO Backend — Phase 0 Event Foundation**

| Field | Value |
|-------|-------|
| **Document ID** | `RELEASE-NOTES-c31f154` |
| **Release Classification** | Release Candidate — Staging Certified |
| **Publication Date** | 2026-08-06 |
| **Certification Program** | HOMIGO Phase 0 |

**Cross-references:**
[Final Certification Report](../final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md) ·
[ADR Index](../architecture/ADR-INDEX.md) ·
[Production Promotion Runbook](../operations/PRODUCTION-PROMOTION-RUNBOOK.md)

---

## Release Identity

| Field | Value |
|-------|-------|
| **Version** | Phase 0 RC — `c31f154` |
| **RC SHA** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| **Image Tag** | `asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154` |
| **Image Digest** | `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32` |
| **Cloud Run Revision** | `homigo-backend-staging-00029-pbn` |
| **Traffic** | 100% → certified revision |

### Environment

| Field | Value |
|-------|-------|
| **Certified Environment** | Staging |
| **GCP Project** | `homigo-497619` |
| **Region** | `asia-south1` |
| **Service** | `homigo-backend-staging` |
| **Database** | `homigo-staging-step6a-pitr-20260803` / `homigo_staging_db` |
| **Migrations** | 31/31 |
| **Production Status** | **NOT DEPLOYED** |

---

## Summary

RC `c31f154` is the **Phase 0 release candidate** certifying HOMIGO's transactional event foundation on staging. This release introduces durable domain event delivery via PostgreSQL transactional outbox, idempotent multi-consumer processing, dead-letter queue with operator replay, and runtime-verified booking, partner, and Razorpay TEST payment lifecycles.

The release completed Stages C through G of the Phase 0 certification program with **237 preserved evidence artifacts**. Production infrastructure was not modified during certification.

**Final staging result:** STAGING CERTIFIED — READY WITH DOCUMENTED LIMITATIONS for production planning.

---

## Major Features Certified

### Booking

- Full lifecycle: create → assign → dispatch → en_route → arrived → start → complete
- Domain events emitted via transactional outbox for each transition
- Step 10 certification: **PASS** (0 critical failures)
- Stage G soak: 9/9 booking workloads succeeded (Run 2)

**Evidence:** `docs/evidence/stage-d-step-10/step-10-booking-certification.md`

### Partner

- Partner dispatch, GPS tracking sequence, arrival detection
- Timestamp ownership: `dispatched_at`, `en_route_at`, `arrived_at`, `travel_duration_min`
- Five-event partner matrix with ordering PASS
- ETA label integrity PASS

**Evidence:** `docs/evidence/stage-d-step-11/step-11-partner-certification.md`

### Payments

- Razorpay TEST integration: order create, verify, webhook settlement
- Webhook HMAC validation and idempotency (`alreadySettled` on duplicate)
- Success and failure paths certified
- Financial atomicity and amount reconciliation PASS
- `homigo.payment.success` event via outbox

**Evidence:** `docs/evidence/stage-d-step-12/step-12-payment-certification.md`

### Outbox

- Transactional outbox pattern (ADR-001)
- Tables: `event_outbox`, `event_consumer_receipts`, `event_dead_letters`
- Burst drain: 100 + 500 events — PASS
- Final pending count: 0 across all certification stages

**Evidence:** `docs/evidence/stage-e-step-14/step-14-outbox-drain-certification.md`

### Events

- Event-driven architecture with `homigo.*` domain events (ADR-002)
- Event flags enabled: `EVENTS_OUTBOX_ENABLED`, `EVENTS_CONSUMERS_ENABLED`
- Stage D harness: 18/18 gates PASS
- 136 events published during Stage G with 0 lost

**Evidence:** `docs/evidence/stage-d/stage-d-certification.md`, `docs/evidence/stage-g-soak/stage-g-final-reconciliation.json`

### Retry

- Hybrid retry: outbox (max 5) + consumer inline (max 3)
- Exponential backoff with jitter: base 2s, max 300s
- Step 16: **PASS_WITH_ARCHITECTURAL_LIMITATION**

**Evidence:** `docs/evidence/stage-e-step-16/step-16-retry-dlq-replay-certification.md`

### DLQ

- `event_dead_letters` per `(eventId, consumerName)`
- Operator replay via `replayDeadLetterById` — PASS
- Final unresolved DLQ: 0

**Evidence:** `docs/evidence/stage-e-step-16/step-16-dlq-state.json`

### Observability

- Permanent staging stack: Prometheus + Grafana v11.3.0 + Alertmanager on GCE VM
- `/metrics` exposition with OPS authentication
- 42 Prometheus alert rules (promtool validated)
- Stage F: **PASS_WITH_LIMITATION**

**Evidence:** `docs/evidence/stage-f-remediation/STAGE-F-REMEDIATION-CERTIFICATION-REPORT.md`

### Alerting

- Event platform alerts: OutboxBacklog, StalePending, ConsumerFailure, DLQ, ScheduledJobLag
- Lifecycle transitions certified for Outbox + Stale
- Slack delivery: NOT_CONFIGURED

**Evidence:** `docs/evidence/stage-f-step-18/step-18-alert-certification.md`

### Soak Test

- Duration: 62.3 minutes (authoritative Run 2)
- Memory growth: +2.5% (STABLE)
- Lost events: 0; Stranded events: 0; DLQ final: 0
- Business regression: NONE
- Note: Run 1 failed due to certification runner harness — remediated in Run 2

**Evidence:** `docs/evidence/stage-g-soak/stage-g-soak-summary.json`

### Reliability

- Multi-instance: LEADER_SINGLE_ACTIVE_WITH_SKIP_LOCKED — PASS
- Idempotency: 0 duplicate effects under concurrent delivery — PASS
- Integration tests: 22/22 PASS
- PITR + backups: ON

**Evidence:** `docs/evidence/stage-e-step-13/`, `docs/evidence/stage-e-step-15/`, `docs/evidence/stage-d-step-8/`

---

## Known Limitations

| Limitation | Severity | Reference |
|------------|----------|-----------|
| Scheduled job execution engine deferred (Phase 6) | MEDIUM | `scheduled-job-lag-root-cause.md` |
| OpenTelemetry export not implemented | MEDIUM | `opentelemetry-gap-analysis.md` |
| Slack/PagerDuty alert delivery not configured | HIGH (prod) | `step-18-slack-delivery.json` |
| HOMIGO Radar UI not built | MEDIUM | `homigo-radar-v1.md` |
| Admin Alert Center ↔ Alertmanager unwired | MEDIUM | Stage F remediation report |
| Direct `dispatchEvent()` not for durable delivery | HIGH (if misused) | Step 16 |
| Cloud Run CPU not in `/metrics` | LOW | Stage G resource trends |
| Operator WHO not recorded on DLQ replay | LOW | Step 16 AUDIT_GAP |

---

## Deferred Work

| Item | Target Phase |
|------|--------------|
| Phase 6 scheduled job runner | Phase 6 |
| OpenTelemetry SDK + Cloud Trace | Post-Phase 0 RC |
| Slack/PagerDuty notification routing | Pre-production |
| HOMIGO Radar operations UI | Phase 1+ |
| Full application schema parity | Wave 2+ |
| Production environment certification | Pre-production |
| LIVE Razorpay certification | Pre-production |

---

## Breaking Changes

**None for Phase 0 certified paths.**

Wave-1 migrations (31 total) introduce schema objects required for Stage D certification. Deployments from pre-Wave-1 baselines (23 migrations @ `e459175`) require migration apply before event-enabled operation.

Event flags default on certified staging revision — deployments from rollback SHA `e459175` with events OFF represent a **capability reduction**, not an API breaking change.

---

## Migration Notes

### Database

| Field | Value |
|-------|-------|
| Required migrations | 31/31 |
| Final migration (Wave-1) | Includes `wallet_transfers`, Stage-D orphan columns |
| Clean replay | PASS — `step-d-wave1-clean-replay-certification.md` |
| Apply command | Cloud Run Job `homigo-staging-migrate-*` or `prisma migrate deploy` |

### Pre-migration requirements

- PITR-enabled instance recommended (certified on staging)
- Backup verification before apply on production (not yet executed)

### Post-migration verification

```bash
prisma migrate status  # expect: up to date, 31/31
```

---

## Database Compatibility

| Component | Version | Certified |
|-----------|---------|-----------|
| PostgreSQL | 16 | YES |
| Cloud SQL | `homigo-staging-step6a-pitr-20260803` | YES |
| Prisma | Validated @ RC `c31f154` | YES |
| Redis | Via `STAGING_REDIS_URL` | YES |

Full application schema parity beyond Wave-1 is **not certified**. Non-Phase-0 tables may log P2021 on deferred paths — explained in Step 6/7 certification.

---

## Rollback Compatibility

| Rollback Target | SHA | Behavior |
|-----------------|-----|----------|
| Phase 0 events OFF baseline | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` | Events disabled; 23/23 migrations |
| Current certified | `c31f154` | Full Phase 0 + Wave-1; events enabled |

**Rollback procedure:** See [ROLLBACK-RUNBOOK.md](../operations/ROLLBACK-RUNBOOK.md)

Database rollback via PITR clone — not in-place restore. Forward-fix preferred for migration issues.

---

## Deployment Notes

### Staging (certified)

```powershell
D:\homigo\deploy\scripts\staging-gcp-deploy.ps1 -CommitSha c31f154a128022fa7d9c4e44652506eedf3fa3e4
```

Verify post-deploy identity matches `stage-g-release-identity.json`.

### Production

**NOT EXECUTED.** Follow [PRODUCTION-PROMOTION-RUNBOOK.md](../operations/PRODUCTION-PROMOTION-RUNBOOK.md).

---

## Risk Summary

| Category | Staging | Production |
|----------|---------|------------|
| Event loss | Mitigated (0 lost) | Unknown — not tested |
| Payment duplication | Mitigated (0 duplicates) | Unknown — LIVE not tested |
| Notification gap | Accepted (no Slack) | Must resolve pre-go-live |
| Scheduled job lag | Accepted (Phase 6) | Same debt until Phase 6 |

Full register: [PHASE-0-RISK-REGISTER.md](../final-certification/PHASE-0-RISK-REGISTER.md)

---

## Evidence References

| Document | Path |
|----------|------|
| Final certification report | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |
| Evidence index (237 files) | `docs/final-certification/PHASE-0-EVIDENCE-INDEX.md` |
| Sign-off | `docs/final-certification/PHASE-0-SIGNOFF.md` |
| ADR index | `docs/architecture/ADR-INDEX.md` |
| Release identity | `docs/evidence/stage-g-soak/stage-g-release-identity.json` |

---

## Final Recommendation

| Audience | Recommendation |
|----------|----------------|
| Engineering | Adopt RC `c31f154` as Phase 0 baseline for all backend event work |
| Release Engineering | **Ready for production planning** — execute promotion runbook |
| Leadership | Accept documented limitations or fund deferred work before go-live |
| Enterprise customers | Staging certification satisfactory; request production cert before SLA |

### Release Classification

| Status | Value |
|--------|-------|
| **Staging** | **CERTIFIED** |
| **Production** | **NOT DEPLOYED** |
| **Production Planning** | **APPROVED WITH CONDITIONS** |

RC `c31f154` is approved as the reference release for production promotion planning. Unconditional production go-live requires completion of the production promotion runbook, notification routing, and leadership sign-off on known limitations.

---

**Prepared by:** Phase 0 Documentation Pass  
**Source of truth:** Runtime certification evidence @ `docs/evidence/` — no results invented for this document.
