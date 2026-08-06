# HOMIGO Phase 0 — Production Readiness Checklist

**Document ID:** `PHASE-0-CHECKLIST-001`  
**Certification RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Environment Verified:** Staging (`homigo-497619` / `asia-south1`)  
**Cross-references:** [Final Report §10](./PHASE-0-FINAL-CERTIFICATION-REPORT.md#10-production-checklist) · [Sign-Off](./PHASE-0-SIGNOFF.md) · [Evidence Index](./PHASE-0-EVIDENCE-INDEX.md)

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | **CERTIFIED** — runtime evidence PASS on staging |
| ⚠️ | **LIMITED** — PASS with documented limitation |
| ⏸️ | **DEFERRED** — not in Phase 0 scope; future phase |
| ❌ | **NOT EXECUTED** — no evidence (typically production-only) |
| ❓ | **UNKNOWN** — insufficient evidence |

---

## 1. Infrastructure

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 1.1 | PostgreSQL 16 provisioned | ✅ | ❓ | `stage-g-environment.json` |
| 1.2 | Authoritative DB instance identified | ✅ | ❓ | `homigo-staging-step6a-pitr-20260803` |
| 1.3 | Redis provisioned & connected | ✅ | ❓ | `/health` redis=ok (Steps 9–G) |
| 1.4 | Cloud Run service deployed | ✅ | ❓ | `homigo-backend-staging-00029-pbn` |
| 1.5 | Multi-instance (min≥2) | ✅ | ❓ | min=2, max=4 |
| 1.6 | Region configured | ✅ | ❓ | `asia-south1` |
| 1.7 | SSL/TLS (Cloud Run managed) | ✅ | ❓ | HTTPS service URL |
| 1.8 | Deletion protection ON | ✅ | ❓ | `stage-g-environment.json` |

---

## 2. Database

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 2.1 | Migrations applied | ✅ 31/31 | ❓ | `stage-g-migrations.json` |
| 2.2 | `prisma migrate status` clean | ✅ | ❓ | Steps 6, 7, 8 |
| 2.3 | Phase 0 schema verified | ✅ | ❓ | `step-7-schema-certification.md` |
| 2.4 | Wave-1 clean replay | ✅ 31/31 | ❓ | `step-d-wave1-clean-replay-certification.md` |
| 2.5 | Backups enabled | ✅ | ❓ | backupEnabled: true |
| 2.6 | PITR enabled | ✅ | ❓ | pitrEnabled: true |
| 2.7 | Restore tested | ✅ | ❓ | `staging-restore-certification.md` |
| 2.8 | Full schema parity | ⏸️ | ⏸️ | DEFERRED beyond Wave-1 |

---

## 3. Secrets & Authentication

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 3.1 | Database URL in Secret Manager | ✅ | ❓ | STAGING_DATABASE_URL |
| 3.2 | Redis URL in Secret Manager | ✅ | ❓ | STAGING_REDIS_URL |
| 3.3 | OPS auth token configured | ✅ | ❓ | `/metrics` 401 without token |
| 3.4 | Razorpay TEST keys | ✅ | ❌ | `rzp_test_*` — Step 12 |
| 3.5 | Razorpay LIVE keys | ❌ N/A | ❓ | Not used in cert |
| 3.6 | Webhook secret configured | ✅ | ❓ | Step 12 |
| 3.7 | JWT/auth middleware | ✅ | ❓ | Step 8 integration tests |
| 3.8 | Rate limits | ❓ | ❓ | Not explicitly certified |
| 3.9 | SECRET_SCAN on evidence | ✅ | ✅ | All stages PASS |
| 3.10 | Grafana admin password | ✅ | ❓ | STAGING_GRAFANA_ADMIN_PASSWORD |

---

## 4. Payments

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 4.1 | Razorpay order creation | ✅ | ❓ | Step 12 |
| 4.2 | Payment verify + settlement | ✅ | ❓ | Step 12 |
| 4.3 | Webhook HMAC validation | ✅ | ❓ | Step 12 |
| 4.4 | Webhook idempotency | ✅ | ❓ | `step-12-webhook-idempotency.json` |
| 4.5 | Failed payment handling | ✅ | ❓ | Step 12 failure path |
| 4.6 | Financial atomicity | ✅ | ❓ | `step-12-financial-atomicity.json` |
| 4.7 | `homigo.payment.success` event | ✅ | ❓ | Step 12 |
| 4.8 | Duplicate payment effects | ✅ 0 | ❓ | All reconciliation JSON |
| 4.9 | LIVE mode safety gate | ✅ NO live | ❓ | All reports |

---

## 5. Booking Platform

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 5.1 | Booking creation | ✅ | ❓ | Step 10 |
| 5.2 | Full lifecycle (create→complete) | ✅ | ❓ | Step 10, Stage D harness |
| 5.3 | Event emission per transition | ✅ | ❓ | `step-10-booking-events.json` |
| 5.4 | Consumer receipts | ✅ | ❓ | `step-10-consumer-receipts.json` |
| 5.5 | Notification regression | ✅ | ❓ | `step-10-notification-regression.json` |
| 5.6 | Soak booking reliability | ✅ 9/9 | ❓ | `stage-g-soak-summary.json` (Run 2) |

---

## 6. Partner Platform

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 6.1 | Partner dispatch | ✅ | ❓ | Step 11 |
| 6.2 | en_route / arrived timestamps | ✅ | ❓ | `step-11-tracking.json` |
| 6.3 | ETA label integrity | ✅ | ❓ | `step-11-eta-labels.json` |
| 6.4 | Partner event matrix (5 events) | ✅ | ❓ | `step-11-partner-events.json` |
| 6.5 | GPS tracking sequence | ✅ | ❓ | Step 11 |

---

## 7. Event Engine

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 7.1 | `EVENTS_OUTBOX_ENABLED=true` | ✅ | ❓ | Step 9 |
| 7.2 | `EVENTS_CONSUMERS_ENABLED=true` | ✅ | ❓ | Step 9 |
| 7.3 | Transactional outbox | ✅ | ❓ | Steps 8, 10, 14 |
| 7.4 | Outbox drain under burst | ✅ | ❓ | Step 14 (100 + 500) |
| 7.5 | Multi-instance claiming | ✅ | ❓ | Step 13 |
| 7.6 | Leader lock semantics | ✅ | ❓ | Step 13 topology |
| 7.7 | Consumer idempotency | ✅ | ❓ | Step 15 |
| 7.8 | Retry with backoff | ✅ | ❓ | Step 16 |
| 7.9 | DLQ on terminal failure | ✅ | ❓ | Step 16 |
| 7.10 | Operator replay | ✅ | ❓ | Step 16 |
| 7.11 | Lost events = 0 | ✅ | ❓ | All reconciliation JSON |
| 7.12 | Stranded events = 0 | ✅ | ❓ | Stage G final |
| 7.13 | Final outbox pending = 0 | ✅ | ❓ | Stage G snapshots |

---

## 8. Observability

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 8.1 | `/metrics` Prometheus exposition | ✅ | ❓ | Steps 9, 17 |
| 8.2 | `/health` endpoint | ✅ | ❓ | All stages |
| 8.3 | Permanent Prometheus | ✅ | ❌ | GCE VM `homigo-obs-staging` |
| 8.4 | Grafana dashboards | ✅ | ❌ | v11.3.0, UID `homigo-operations` |
| 8.5 | Alertmanager | ✅ | ❌ | Stage F remediation |
| 8.6 | Alert rules validated | ✅ | ❓ | 42 rules promtool PASS |
| 8.7 | Event platform alert lifecycles | ⚠️ | ❓ | Step 18 — partial limitations |
| 8.8 | Structured JSON logging | ✅ | ❓ | Stage F remediation |
| 8.9 | OpenTelemetry export | ⏸️ | ⏸️ | NOT_IMPLEMENTED |
| 8.10 | Grafana ↔ log correlation | ⚠️ | ❓ | PARTIAL — manual workflow |
| 8.11 | HOMIGO Radar UI | ⏸️ | ⏸️ | Spec only |
| 8.12 | Sentry integration | ❓ | ❓ | EXISTS in codebase; not Stage F certified |

---

## 9. Alerts & Notifications

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 9.1 | EventOutboxBacklogHigh | ✅ evaluates | ❓ | Step 18 lifecycle PASS |
| 9.2 | EventOutboxOldestPendingStale | ✅ evaluates | ❓ | Step 18 lifecycle PASS |
| 9.3 | EventConsumerFailureRateHigh | ⚠️ | ❓ | Safe injection impractical |
| 9.4 | EventDlqGrowing | ⚠️ | ❓ | Firing not awaited (15m for:) |
| 9.5 | ScheduledJobLagHigh | ⚠️ firing | ❓ | Known Phase 6 debt |
| 9.6 | Slack delivery | ❌ NOT_CONFIGURED | ❓ | No webhook secret |
| 9.7 | Admin Alert Center bridge | ⏸️ | ⏸️ | Not wired on c31f154 |
| 9.8 | No false alerts during soak | ✅ | ❓ | `stage-g-alert-review.json` |

---

## 10. Performance & Reliability

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 10.1 | Integration test suite | ✅ 22/22 | ❓ | Step 8 |
| 10.2 | Event p50 latency | ✅ ~0.019s | ❓ | Stage G snapshots |
| 10.3 | Event p95 latency | ✅ ~0.043s | ❓ | Stage G snapshots |
| 10.4 | Memory stability (soak) | ✅ +2.5% | ❓ | `stage-g-soak-summary.json` |
| 10.5 | CPU stability | ⚠️ | ❓ | INCONCLUSIVE — not in /metrics |
| 10.6 | DB connection stability | ✅ | ❓ | Stage G postgres snapshots |
| 10.7 | Redis stability | ✅ | ❓ | redis_up=1 throughout |
| 10.8 | Soak duration ≥60 min | ✅ 62.3 min | ❓ | Run 2 |
| 10.9 | Business regression | ✅ NONE | ❓ | Stage G Run 2 |
| 10.10 | DLQ final = 0 | ✅ | ❓ | All stages |

---

## 11. Disaster Recovery

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 11.1 | Backup retention configured | ✅ 7 retained | ❓ | Step 10 pre-flight |
| 11.2 | PITR clone tested | ✅ | ❓ | Step 4 + Step 6A |
| 11.3 | Restore runbook | ✅ | ❓ | `docs/runbooks/database-restore.md` |
| 11.4 | Rollback procedure documented | ✅ | ❓ | `stage-d-runbook.md` |
| 11.5 | Production DR tested | ❌ | ❓ | Staging only |

---

## 12. Operational Maturity

| # | Check | Staging | Production | Evidence |
|---|-------|---------|------------|----------|
| 12.1 | Certification harness committed | ✅ | N/A | `apps/backend/scripts/` |
| 12.2 | Evidence preservation | ✅ 237 files | N/A | `docs/evidence/` |
| 12.3 | ADR for observability | ✅ | ❓ | `adr-001-staging-observability-platform.md` |
| 12.4 | Runbooks | ✅ | ❓ | stage-d-runbook, database-restore |
| 12.5 | Production deployment | ❌ NOT EXECUTED | ❌ | Staging cert only |
| 12.6 | On-call rotation | ❓ | ❓ | Not in Phase 0 scope |

---

## Summary Counts (Staging)

| Status | Count |
|--------|-------|
| ✅ CERTIFIED | 78 |
| ⚠️ LIMITED | 9 |
| ⏸️ DEFERRED | 8 |
| ❌ NOT EXECUTED / N/A | 12 |
| ❓ UNKNOWN | 14 |

**Staging readiness:** **READY WITH DOCUMENTED LIMITATIONS**  
**Production readiness:** **NOT EXECUTED** — requires production environment checklist execution

---

## Pre-Production Promotion Gates

Before production deploy of RC `c31f154` (or successor):

- [ ] Execute production checklist (duplicate this document for prod environment)
- [ ] Provision production secrets (DB, Redis, Razorpay LIVE, OPS token)
- [ ] Configure production observability (Prometheus/GMP or equivalent)
- [ ] Wire alert notification routing (Slack/PagerDuty)
- [ ] Accept or resolve R-DEF-001 through R-DEF-008 from [Risk Register](./PHASE-0-RISK-REGISTER.md)
- [ ] Human sign-off on [PHASE-0-SIGNOFF.md](./PHASE-0-SIGNOFF.md)
