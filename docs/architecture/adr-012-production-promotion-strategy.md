# ADR-012: Production Promotion Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Release Engineering / CTO |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

Phase 0 completed **staging certification** for RC `c31f154`. Production has **not** been deployed, modified, or runtime-validated. This ADR defines the strategy for promoting a staging-certified release to production — it does not constitute production deployment approval.

Final certification outcome: **READY WITH DOCUMENTED LIMITATIONS** — production planning approved subject to checklist completion and limitation acceptance.

---

## Problem

Promoting staging-certified code to production without a defined strategy risks:

1. Deploying with TEST Razorpay credentials or staging database URLs.
2. Enabling event consumers before production observability exists.
3. Ignoring documented limitations (scheduled job runner, Slack routing, OTel).
4. Irreversible migration without PITR verification.
5. Treating staging certification as equivalent to production validation.

---

## Decision

### Promotion model: **Controlled promotion with pre-flight gates**

Production promotion of RC `c31f154` (or successor RC re-certified on staging) requires:

#### Gate 1 — Documentation and approval

- [ ] [PHASE-0-SIGNOFF.md](../final-certification/PHASE-0-SIGNOFF.md) human signatures (CTO, Release Engineering)
- [ ] [PHASE-0-RISK-REGISTER.md](../final-certification/PHASE-0-RISK-REGISTER.md) accepted by leadership
- [ ] [PRODUCTION-PROMOTION-RUNBOOK.md](../operations/PRODUCTION-PROMOTION-RUNBOOK.md) reviewed by on-call team

#### Gate 2 — Production environment provisioning

- [ ] Production GCP project verified (separate from `homigo-497619` or isolated prod resources)
- [ ] Production Cloud SQL with backups ON, PITR ON, deletion protection ON
- [ ] Production secrets: DATABASE_URL, REDIS_URL, OPS token, Razorpay **LIVE** keys, webhook secrets
- [ ] Production observability stack (mirror ADR-008 or GMP equivalent)
- [ ] Alert notification routing configured (ADR-009 — Slack/PagerDuty)

#### Gate 3 — Migration safety

- [ ] `prisma migrate deploy` on production from clean job (31/31 or successor count)
- [ ] Migration dry-run on PITR clone before production apply
- [ ] Rollback revision identified and digest-pinned

#### Gate 4 — Deploy and validate

- [ ] Digest-pinned deploy per ADR-010
- [ ] Health, readiness, metrics probes PASS
- [ ] Smoke tests per production promotion runbook
- [ ] 24-hour monitoring window with on-call

#### Gate 5 — Event platform enablement (phased)

Mirroring Stage D incremental approach:

1. Deploy with `EVENTS_OUTBOX_ENABLED=true`, `EVENTS_CONSUMERS_ENABLED=false`
2. Verify outbox processor metrics
3. Enable consumers domain-by-domain (booking → partner → payment)
4. Monitor `homigo_outbox_pending`, `homigo_dlq_unresolved`

### Explicit non-goals for first production deploy

| Item | Status | Rationale |
|------|--------|-----------|
| Phase 6 scheduled job runner | DEFERRED | Known lag alert; non-blocking on staging |
| OpenTelemetry export | DEFERRED | Gap documented; not blocking core paths |
| HOMIGO Radar UI | DEFERRED | Grafana sufficient for engineering initially |
| Full schema beyond Wave-1 | DEFERRED | Phase 0 paths only certified |

### Rollback strategy

- **Application:** Cloud Run revision rollback to prior digest (see [ROLLBACK-RUNBOOK.md](../operations/ROLLBACK-RUNBOOK.md))
- **Database:** Forward-fix preferred; PITR clone for catastrophic failure only
- **Events:** Do not disable outbox with pending rows; drain before flag change

### Production certification cycle

Staging certification **does not substitute** for production validation. After first production deploy, execute a abbreviated certification (health, smoke, payment LIVE in controlled amount, 1-hour monitoring) and preserve evidence separately.

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Immediate full production deploy post Phase 0** | Production untouched; limitations unresolved |
| **Dark launch without events** | Valid as Gate 4 sub-phase; events required for core product |
| **Big-bang all flags ON** | Stage D proved incremental safer |
| **Skip production cert cycle** | Enterprise customers require prod evidence |
| **Different RC for production** | Allowed if re-certified on staging first |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Staging-proven RC reduces unknowns | Production-specific failures still possible |
| Phased event enablement limits blast radius | Multi-step promotion timeline |
| Explicit limitation acceptance | Leadership sign-off overhead |
| PITR safety net | Clone time ~8–10 minutes |

---

## Consequences

**Positive:**
- Clear separation: STAGING CERTIFIED vs PRODUCTION DEPLOYED.
- Runbooks exist before first production change.
- Risk register drives pre-prod work items.

**Negative:**
- Time-to-production extended by provisioning and prod cert cycle.
- LIVE Razorpay requires separate financial compliance review.

**Current state (@ 2026-08-06):**

| Environment | RC `c31f154` Status |
|-------------|---------------------|
| Staging | DEPLOYED, CERTIFIED |
| Production | NOT DEPLOYED, NOT CERTIFIED |

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Production readiness checklist | `docs/final-certification/PHASE-0-PRODUCTION-READINESS-CHECKLIST.md` |
| Risk register | `docs/final-certification/PHASE-0-RISK-REGISTER.md` |
| Final report §7, §10 | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |
| Stage G SAFE_TO_PROCEED | `docs/evidence/stage-g-soak/stage-g-soak-summary.json` |
| Production promotion runbook | `docs/operations/PRODUCTION-PROMOTION-RUNBOOK.md` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Production certification harness | Pre-prod | Adapt staging scripts |
| Automated promotion pipeline | Release Engineering | CI/CD with gate checks |
| Feature flag service | Platform | Replace env-var flags |
| Multi-region production | Scale | ADR revision required |

---

## Related ADRs

ADR-010 (Deployment) · ADR-011 (Staging Certification) · ADR-007 (Payment) · ADR-008/009 (Observability/Alerts)
